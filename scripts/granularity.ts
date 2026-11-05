import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";
import { escapeRegExp, logToStderr, plural, runQuiet } from "./util";

const usage = `Usage:
  mazeratta crumbs more <file>    give the components <file> renders their own crumbs
  mazeratta crumbs fewer <file>   take those crumbs away again

Crumb granularity, done the same way every time. A child is a component <file>
imports from a barrel. more turns each child's plain re-export into a withCrumb
entry; fewer turns it back. Only barrels change, never component files.

When <file> has no child components, more changes nothing and exits ${3}: extract
its regions into their own components (one file each, re-exported from the
barrel, imported from it in <file>), then run it again.

<file> is the path from the note, relative to here or to the git root.`;

const NEEDS_EXTRACTION = 3;
const BARREL_NAMES = ["index.ts", "index.js", "index.tsx"];
const COMPONENT_EXTENSIONS = ["", ".tsx", ".jsx", ".ts", ".js", ".svelte"];
const WILDCARD_RE_EXPORT = /^export\s*\*\s*from\s*["']([^"']+)["']/gm;
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const TYPE_ONLY_PREFIX = /^type\s+/;
const AS_ALIAS = /\s+as\s+/;
const COMPONENT_NAME = /^[A-Z]\w*$/;
const DEFAULT_IMPORT_FROM_RELATIVE = /import\s+(\w+)\s+from\s*["'](\.[^"']*)["']/g;
const SRC_FIELD = /\bsrc\s*:\s*["']([^"']+)["']/g;
const IMPORT_LINE = /^import .*;?[ \t]*$/gm;
const IMPORT_LINE_WITH_NEWLINE = /^import[^\n]*\n/gm;
const IMPORTS_WITH_CRUMB = /import\s*\{[^}]*\bwithCrumb\b[^}]*\}\s*from/;
const WITH_CRUMB_IMPORT_LINE = /^import\s*\{\s*withCrumb\s*\}\s*from\s*["'][^"']+["'];?[ \t]*\n/m;
const LEADING_BLANK_LINES = /^\n+/;

type Child = { name: string; barrel: string; kind: "plain" | "crumbed"; spec: string };

function fail(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

const [direction, noteFile, ...extra] = process.argv.slice(2);
if (!direction || direction === "-h" || direction === "--help") {
  console.log(usage);
  process.exit(direction ? 0 : 2);
}
if (direction !== "more" && direction !== "fewer") fail(`Unknown direction: ${direction} (more or fewer)\n\n${usage}`);
if (!noteFile || extra.length) fail(`Give exactly one file: the one from the note\n\n${usage}`);

const CWD = process.cwd();
const GIT_ROOT = runQuiet(["git", "rev-parse", "--show-toplevel"], CWD) || CWD;
const PARENT = [resolve(CWD, noteFile), join(GIT_ROOT, noteFile)].find((p) => existsSync(p) && statSync(p).isFile())
  ?? fail(`No such file, here or under ${GIT_ROOT}: ${noteFile}`);
logToStderr(`Reading ${relative(CWD, PARENT) || PARENT}`);

const barrelTexts = new Map<string, string>();
function barrelText(path: string) {
  if (!barrelTexts.has(path)) barrelTexts.set(path, readFileSync(path, "utf8"));
  return barrelTexts.get(path)!;
}
function existingFile(base: string, extensions = COMPONENT_EXTENSIONS) {
  return extensions.map((ext) => base + ext).find((p) => existsSync(p) && statSync(p).isFile());
}
function barrelAt(fromDir: string, spec: string) {
  if (!spec.startsWith(".")) return undefined;
  const target = resolve(fromDir, spec);
  if (existsSync(target) && statSync(target).isDirectory()) return BARREL_NAMES.map((n) => join(target, n)).find((p) => existsSync(p));
  const file = existingFile(target, ["", ".ts", ".js", ".tsx"]);
  return file && BARREL_NAMES.includes(basename(file)) ? file : undefined;
}

function entryPattern(name: string) {
  return new RegExp(`^export\\s+const\\s+${escapeRegExp(name)}\\s*=\\s*withCrumb\\(\\s*(\\w+)\\s*,\\s*\\{[\\s\\S]*?\\}\\s*\\);?[ \\t]*$`, "m");
}
function plainPattern(name: string) {
  return new RegExp(`^export\\s*\\{\\s*default\\s+as\\s+${escapeRegExp(name)}\\s*\\}\\s*from\\s*["']([^"']+)["'];?[ \\t]*$`, "m");
}
function baseImportPattern(base: string) {
  return new RegExp(`^import\\s+${escapeRegExp(base)}\\s+from\\s+["']([^"']+)["'];?[ \\t]*\\n`, "m");
}

function findChild(barrel: string, name: string, seen = new Set<string>()): Child | undefined {
  if (seen.has(barrel)) return undefined;
  seen.add(barrel);
  const text = barrelText(barrel);
  const entry = text.match(entryPattern(name));
  if (entry) {
    const spec = text.match(baseImportPattern(entry[1]))?.[1];
    if (spec) return { name, barrel, kind: "crumbed", spec };
  }
  const plain = text.match(plainPattern(name));
  if (plain) return { name, barrel, kind: "plain", spec: plain[1] };
  for (const reExport of text.matchAll(WILDCARD_RE_EXPORT)) {
    const sub = barrelAt(dirname(barrel), reExport[1]);
    const found = sub && findChild(sub, name, seen);
    if (found) return found;
  }
  return undefined;
}

function childrenOf(parent: string) {
  const text = readFileSync(parent, "utf8");
  const children: Child[] = [];
  const unresolved: string[] = [];
  for (const imported of text.matchAll(NAMED_IMPORT)) {
    const barrel = barrelAt(dirname(parent), imported[2]);
    if (!barrel) continue;
    for (const part of imported[1].split(",")) {
      const name = part.trim().replace(TYPE_ONLY_PREFIX, "").split(AS_ALIAS)[0].trim();
      if (!COMPONENT_NAME.test(name)) continue;
      const child = findChild(barrel, name);
      if (child) children.push(child);
      else unresolved.push(name);
    }
  }
  const directImports = [...text.matchAll(DEFAULT_IMPORT_FROM_RELATIVE)]
    .filter(([, , spec]) => spec.endsWith(".svelte") || existingFile(resolve(dirname(parent), spec), [".tsx", ".jsx"]))
    .map(([, name, spec]) => `${name} from "${spec}"`);
  return { children, unresolved, directImports };
}

function projectRoot(dir: string) {
  for (let d = dir; d !== dirname(d); d = dirname(d)) if (existsSync(join(d, "package.json"))) return d;
  return GIT_ROOT;
}
function crumbsImportPath(barrelDir: string) {
  for (let d = barrelDir; d !== dirname(d); d = dirname(d)) {
    if (BARREL_NAMES.some((n) => existsSync(join(d, "crumbs", n)))) {
      const path = relative(barrelDir, join(d, "crumbs"));
      return path.startsWith(".") ? path : `./${path}`;
    }
  }
  fail(`No crumbs folder above ${barrelDir}`);
}
function srcBase(barrel: string) {
  const root = projectRoot(dirname(barrel));
  const barrels = [...new Glob(`**/{${BARREL_NAMES.join(",")}}`).scanSync({ cwd: root, onlyFiles: true })].filter((p) => !p.includes("node_modules/"));
  for (const path of barrels) {
    for (const match of readFileSync(join(root, path), "utf8").matchAll(SRC_FIELD)) {
      if (existsSync(join(root, match[1]))) return root;
      if (existsSync(join(GIT_ROOT, match[1]))) return GIT_ROOT;
    }
  }
  return GIT_ROOT;
}

function crumbChild(child: Child) {
  const barrelDir = dirname(child.barrel);
  const file = existingFile(resolve(barrelDir, child.spec)) ?? fail(`${child.barrel} re-exports ${child.name} from ${child.spec}, which doesn't exist`);
  const base = `${child.name}Base`;
  const entry = `export const ${child.name} = withCrumb(${base}, { src: "${relative(srcBase(child.barrel), file)}" });`;
  let text = barrelText(child.barrel).replace(plainPattern(child.name), entry);
  const imports = [...text.matchAll(IMPORT_LINE)];
  const importLine = `import ${base} from "${child.spec}";`;
  const at = imports.length ? imports[imports.length - 1].index! + imports[imports.length - 1][0].length + 1 : 0;
  text = text.slice(0, at) + importLine + "\n" + (imports.length ? "" : "\n") + text.slice(at);
  if (!IMPORTS_WITH_CRUMB.test(text)) text = `import { withCrumb } from "${crumbsImportPath(barrelDir)}";\n` + text;
  barrelTexts.set(child.barrel, text);
}

function uncrumbChild(child: Child) {
  let text = barrelText(child.barrel);
  const base = text.match(entryPattern(child.name))![1];
  text = text.replace(entryPattern(child.name), `export { default as ${child.name} } from "${child.spec}";`);
  text = text.replace(baseImportPattern(base), "");
  if (!text.replace(IMPORT_LINE_WITH_NEWLINE, "").includes("withCrumb(")) text = text.replace(WITH_CRUMB_IMPORT_LINE, "");
  barrelTexts.set(child.barrel, text.replace(LEADING_BLANK_LINES, ""));
}

const { children, unresolved, directImports } = childrenOf(PARENT);
logToStderr(`Children from barrels: ${children.map((c) => `${c.name} (${c.kind})`).join(", ") || "none"}`);
if (unresolved.length) logToStderr(`Imported from a barrel but not found as a component there: ${unresolved.join(", ")}`);
if (directImports.length) {
  console.log(`Imported from their files, not the barrel, so not crumbable as children (import them from the barrel):`);
  for (const line of directImports) console.log(`  ${line}`);
}

const toChange = children.filter((c) => c.kind === (direction === "more" ? "plain" : "crumbed"));
if (!toChange.length) {
  if (direction === "fewer") {
    console.log(`No crumbed children in ${noteFile}; nothing to take away.`);
    process.exit(0);
  }
  if (children.length) {
    console.log(`Every child of ${noteFile} is crumbed already: ${children.map((c) => c.name).join(", ")}.`);
    console.log(`One level per request: run more on one of those files to go deeper.`);
    process.exit(0);
  }
  console.log(`${noteFile} renders no child components, so there is nothing to crumb yet; nothing was changed.`);
  console.log(`Extract its regions into their own components: one file each beside the barrel, re-exported from it`);
  console.log(`(export { default as Name } from "./Name"), imported from it in ${noteFile}. Then run this again.`);
  process.exit(NEEDS_EXTRACTION);
}

for (const child of toChange) (direction === "more" ? crumbChild : uncrumbChild)(child);
const touched = [...new Set(toChange.map((c) => c.barrel))];
for (const barrel of touched) writeFileSync(barrel, barrelTexts.get(barrel)!);
console.log(
  `${direction === "more" ? "Crumbed" : "Uncrumbed"} ${plural(toChange.length, "child", "children")} of ${noteFile}: ${toChange.map((c) => c.name).join(", ")}` +
    ` (${touched.map((b) => relative(CWD, b)).join(", ")}).`,
);
