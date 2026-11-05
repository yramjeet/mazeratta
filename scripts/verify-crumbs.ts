import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Glob } from "bun";
import { escapeRegExp, plural, runQuiet } from "./util";

const usage = `Usage:
  mazeratta verify [project-dir] [--full-coverage] [--no-comments]

Checks what the barrel model loses silently: a component importing the crumbs
folder, a barrel its parent barrel doesn't re-export, and a crumb whose src
points at a file that doesn't exist.

--full-coverage  also fails a component with no barrel entry, and a directory
                 of components with no barrel (the templates crumb everything;
                 an integrated project crumbs one level and grows from there)
--no-comments    also fails any comment in src/ (the templates' docs-not-comments rule)`;

const FLAGS = ["--full-coverage", "--no-comments"];

function parseArgs(args: string[]) {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(usage);
    process.exit(0);
  }
  const unknown = args.filter((a) => a.startsWith("-") && !FLAGS.includes(a));
  const positional = args.filter((a) => !a.startsWith("-"));
  if (unknown.length || positional.length > 1) {
    console.error(`${unknown.length ? `Unknown option: ${unknown.join(", ")}` : `One project directory at most`}\n\n${usage}`);
    process.exit(2);
  }
  return {
    projectDir: resolve(positional[0] ?? "."),
    fullCoverage: args.includes("--full-coverage"),
    noComments: args.includes("--no-comments"),
  };
}

const { projectDir: PROJECT, fullCoverage: FULL_COVERAGE, noComments: NO_COMMENTS } = parseArgs(process.argv.slice(2));

const BARREL_NAMES = ["index.ts", "index.js", "index.tsx"];
const COMPONENT_FILE = /\.(tsx|jsx|svelte)$/;
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/;
const TRAILING_COMMENT = /[^:]\/\/\s/;
const CRUMBS_IMPORT = /from\s+["'][^"']*\bcrumbs(?:\/[^"']*)?["']|^\s*import\s+["'][^"']*\bcrumbs\//m;
const NODE_MODULES_PATH = /(^|\/)node_modules\//;
const SRC_FIELD = /\bsrc\s*:\s*["']([^"']+)["']/;

function projectPath(...p: string[]) {
  return join(PROJECT, ...p);
}
async function readProjectText(p: string) {
  const file = Bun.file(projectPath(p));
  return (await file.exists()) ? file.text() : "";
}
async function scanProject(pattern: string) {
  const paths: string[] = [];
  for await (const p of new Glob(pattern).scan({ cwd: PROJECT, onlyFiles: true })) {
    if (!NODE_MODULES_PATH.test(p)) paths.push(p);
  }
  return paths.sort();
}

const COMPONENTS_DIR =
  ["src/components", "src/lib/components", "components", "app/components"].find((d) => existsSync(projectPath(d))) ?? "";
if (!COMPONENTS_DIR) {
  console.error(`No components directory in ${PROJECT} (looked for src/components, src/lib/components, components, app/components)`);
  process.exit(2);
}
const GIT_ROOT = runQuiet(["git", "rev-parse", "--show-toplevel"], PROJECT) || PROJECT;

function withoutComments(text: string) {
  return text
    .split("\n")
    .filter((l) => !COMMENT_LINE.test(l))
    .join("\n");
}
function barrelPathIn(dir: string) {
  return BARREL_NAMES.map((name) => `${dir}/${name}`).find((p) => existsSync(projectPath(p)));
}
async function barrelTextIn(dir: string) {
  const path = barrelPathIn(dir);
  return path ? withoutComments(await readProjectText(path)) : "";
}
function importsModule(barrel: string, module: string) {
  return new RegExp(`["']\\./${escapeRegExp(module)}["']`).test(barrel);
}

let failures = 0;
function fail(msg: string) {
  console.log(`FAIL ${msg}`);
  failures++;
}

const componentFiles = await scanProject(`${COMPONENTS_DIR}/**/*.{tsx,jsx,svelte}`);
const componentsByDir = Map.groupBy(componentFiles, (path) => dirname(path));

for (const path of componentFiles) {
  if (CRUMBS_IMPORT.test(await readProjectText(path))) fail(`${path}\n     Imports the crumbs folder directly; only barrels declare crumbs`);
}

if (FULL_COVERAGE && !barrelPathIn(COMPONENTS_DIR)) fail(`${COMPONENTS_DIR}/index.ts is missing — it is where crumbs are declared`);

const reExportsChecked = new Set<string>();
for (const dir of [...componentsByDir.keys()].sort()) {
  if (!barrelPathIn(dir)) {
    if (FULL_COVERAGE) fail(`${dir}/index.ts is missing — ${plural(componentsByDir.get(dir)!.length, "component", "components")} here have no crumbs`);
    continue;
  }
  for (let child = dir; child !== COMPONENTS_DIR && child.startsWith(`${COMPONENTS_DIR}/`); child = dirname(child)) {
    const parent = dirname(child);
    if (reExportsChecked.has(child)) break;
    reExportsChecked.add(child);
    if (!importsModule(await barrelTextIn(parent), basename(child))) {
      fail(`${barrelPathIn(parent) ?? `${parent}/index.ts`} does not re-export "./${basename(child)}" — the crumbs under ${child} are unreachable`);
    }
  }
}

if (FULL_COVERAGE) {
  for (const [dir, files] of componentsByDir) {
    const barrel = await barrelTextIn(dir);
    if (!barrel) continue;
    for (const path of files) {
      const file = basename(path);
      if (importsModule(barrel, file.replace(COMPONENT_FILE, "")) || importsModule(barrel, file)) console.log(`OK   ${path}`);
      else fail(`${path}\n     No entry in ${barrelPathIn(dir)} — it will render with no crumb`);
    }
  }
}

let srcPathsChecked = 0;
for (const path of await scanProject(`**/{${BARREL_NAMES.join(",")}}`)) {
  const text = await readProjectText(path);
  if (!text.includes("withCrumb(")) continue;
  for (const [i, line] of text.split("\n").entries()) {
    if (COMMENT_LINE.test(line)) continue;
    const file = line.match(SRC_FIELD)?.[1];
    if (!file) continue;
    srcPathsChecked++;
    if (![join(PROJECT, file), join(GIT_ROOT, file)].some((p) => existsSync(p))) {
      fail(`${path}:${i + 1}\n     Its src "${file}" does not exist (moved directory?)`);
      continue;
    }
    console.log(`OK   src ${file}`);
  }
}

let filesCheckedForComments = 0;
if (NO_COMMENTS) {
  for (const path of await scanProject("src/**/*.{ts,tsx,jsx,js,svelte,css}")) {
    filesCheckedForComments++;
    const isComment = path.endsWith(".css")
      ? (l: string) => l.includes("/*")
      : path.endsWith(".svelte")
        ? (l: string) => l.includes("<!--") || COMMENT_LINE.test(l) || TRAILING_COMMENT.test(l)
        : (l: string) => COMMENT_LINE.test(l) || TRAILING_COMMENT.test(l);
    for (const [i, l] of (await readProjectText(path)).split("\n").entries()) {
      if (isComment(l) && !l.includes("@refresh")) fail(`${path}:${i + 1}\n     Comment in code — move it to the docs\n       ${l.trim()}`);
    }
  }
}

console.log(
  failures === 0
    ? `\n${plural(componentFiles.length, "component", "components")} in ${plural(componentsByDir.size, "directory", "directories")}, ` +
        plural(srcPathsChecked, "src path", "src paths") +
        (NO_COMMENTS ? `, ${plural(filesCheckedForComments, "source file", "source files")} comment-free` : "") +
        " — all good"
    : `\n${plural(failures, "problem", "problems")}`,
);
process.exit(failures === 0 ? 0 : 1);
