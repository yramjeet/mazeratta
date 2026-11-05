import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { progressSection, stepTitles } from "./report-progress";
import { MAZERATTA_COMMAND, currentTmuxSession, logToStderr, runQuiet } from "./util";

type Framework = "solidjs" | "reactjs" | "svelte";

const FRAMEWORKS: Framework[] = ["solidjs", "reactjs", "svelte"];
const MAZERATTA_DIR = join(import.meta.dir, "..");
const FIRST_NUMBER = /\d+/;
const MODULE_SCRIPT_TYPE_FIRST = /<script[^>]*type="module"[^>]*src="\/?([^"]+)"/;
const MODULE_SCRIPT_SRC_FIRST = /<script[^>]*src="\/?([^"]+)"[^>]*type="module"/;
const APP_DEFAULT_IMPORT = /^import\s+(\w*App\w*)\s+from\s+["']([^"']+)["'];?$/m;
const INDEX_FILE_NAME = /^index\.\w+$/;
const FRAMEWORK_FILES: Record<Framework, { ext: string; app: string; shell: string }> = {
  solidjs: { ext: ".tsx", app: "App", shell: "App.tsx" },
  reactjs: { ext: ".tsx", app: "App", shell: "App.tsx" },
  svelte: { ext: ".svelte", app: "App.svelte", shell: "App.svelte" },
};

const usage = `Usage:
  mazeratta integrate [project-dir] [--as ${FRAMEWORKS.join("|")}]

Prints a brief for a coding agent: what was detected in the project, the exact
steps to wire crumbs in, and how to run the note loop. Reads only; changes nothing.
--as picks the framework when detection finds none, or more than one.
To take crumbs out again: mazeratta remove.`;

function parseArgs(args: string[]) {
  let forced: Framework | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (args[i] !== "--as") {
      positional.push(args[i]);
      continue;
    }
    const framework = args[++i] as Framework;
    if (!FRAMEWORKS.includes(framework) || forced) {
      console.error(`--as takes one of ${FRAMEWORKS.join(", ")}, once\n\n${usage}`);
      process.exit(2);
    }
    forced = framework;
  }
  return { forced, projectDir: resolve(positional[0] ?? ".") };
}

const { forced, projectDir: PROJECT } = parseArgs(process.argv.slice(2));
if (!existsSync(PROJECT) || !statSync(PROJECT).isDirectory()) {
  console.error(`Not a directory: ${PROJECT}`);
  process.exit(2);
}

logToStderr(`Checking ${PROJECT}`);

function projectPath(...p: string[]) {
  return join(PROJECT, ...p);
}
function projectHas(...p: string[]) {
  return existsSync(projectPath(...p));
}
async function readProjectText(...p: string[]) {
  return projectHas(...p) ? Bun.file(projectPath(...p)).text() : "";
}
function firstExisting(candidates: string[]) {
  return candidates.find((c) => projectHas(c));
}
function majorVersion(v?: string) {
  return Number(v?.match(FIRST_NUMBER)?.[0] ?? NaN);
}

const gitRoot = runQuiet(["git", "rev-parse", "--show-toplevel"], PROJECT) || PROJECT;
const repoPrefix = relative(gitRoot, PROJECT);
logToStderr(`Git root: ${gitRoot === PROJECT ? "same as the project" : `${gitRoot}, so every src starts with ${repoPrefix}/`}`);
function repoPath(p: string) {
  return repoPrefix ? `${repoPrefix}/${p}` : p;
}

const packageJson = projectHas("package.json") ? await Bun.file(projectPath("package.json")).json() : null;
const dependencies: Record<string, string> = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
logToStderr(`package.json: ${packageJson ? `found, ${Object.keys(dependencies).length} dependencies` : "not found"}`);
const LOCKFILES: [string, string][] = [["bun.lock", "bun"], ["bun.lockb", "bun"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"]];
const lockfile = LOCKFILES.find(([file]) => projectHas(file));
const packageManager = lockfile?.[1] ?? "npm";
logToStderr(`Package manager: ${packageManager} (${lockfile ? `from ${lockfile[0]}` : "no bun, pnpm or yarn lockfile"})`);
const PORT_STATUS: Record<string, string> = JSON.parse(await Bun.file(join(MAZERATTA_DIR, "templates", "status.json")).text());

const found: Framework[] = forced
  ? [forced]
  : ([dependencies["svelte"] && "svelte", dependencies["solid-js"] && "solidjs", dependencies["react"] && "reactjs"].filter(Boolean) as Framework[]);
const framework = found.length === 1 ? found[0] : undefined;
const FRAMEWORK_PACKAGE: Record<Framework, string> = { solidjs: "solid-js", reactjs: "react", svelte: "svelte" };
if (forced) logToStderr(`Stack: ${forced} (from --as)`);
else if (!found.length) logToStderr("Stack: none found (no svelte, solid-js or react dependency)");
else for (const f of found) logToStderr(`Stack: ${f} (the ${FRAMEWORK_PACKAGE[f]} dependency, ${dependencies[FRAMEWORK_PACKAGE[f]]})`);
if (found.length > 1) logToStderr("Several stacks: the brief asks for --as instead of giving steps");
for (const f of found) logToStderr(`Port status: ${f} ${PORT_STATUS[f] ?? "beta"}`);

async function inspectStack(framework: Framework) {
  const metaFramework = dependencies["@sveltejs/kit"]
    ? "SvelteKit"
    : dependencies["@solidjs/start"]
      ? "SolidStart"
      : dependencies["next"]
        ? "Next.js"
        : dependencies["astro"]
          ? "Astro"
          : dependencies["react-scripts"]
            ? "Create React App"
            : "";
  const usesVite = Boolean(dependencies["vite"]) || metaFramework === "SvelteKit" || metaFramework === "SolidStart" || metaFramework === "Astro";
  const version = dependencies[FRAMEWORK_PACKAGE[framework]];
  logToStderr(`Meta-framework: ${metaFramework || "none"}; bundler: ${usesVite ? "Vite" : "not Vite"}`);

  const html = await readProjectText("index.html");
  const scriptSrc =
    html.match(MODULE_SCRIPT_TYPE_FIRST)?.[1] ?? html.match(MODULE_SCRIPT_SRC_FIRST)?.[1];
  const entry =
    (scriptSrc && projectHas(scriptSrc) ? scriptSrc : undefined) ??
    firstExisting(["src/main.ts", "src/main.tsx", "src/main.js", "src/main.jsx", "src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js"]);
  const srcDir = entry ? dirname(entry) : projectHas("src") ? "src" : ".";
  logToStderr(
    `Entry: ${entry ?? "not found"}${entry ? (entry === scriptSrc ? " (the module script in index.html)" : " (the first of src/main.*, src/index.* that exists)") : ""}`,
  );
  const appImport = (entry ? await readProjectText(entry) : "").match(APP_DEFAULT_IMPORT);
  logToStderr(`App import in the entry: ${appImport ? `${appImport[1]} from "${appImport[2]}"` : "not found"}`);
  const components = firstExisting([`${srcDir}/components`, "src/lib/components", "components", "app/components"]);
  const componentsDir = components ?? `${srcDir}/components`;
  const barrel = firstExisting([`${componentsDir}/index.ts`, `${componentsDir}/index.js`, `${componentsDir}/index.tsx`]);
  logToStderr(`Components: ${components ?? `none, so the brief creates ${componentsDir}`}; barrel: ${barrel ?? "none"}`);
  const crumbsDir = `${srcDir}/crumbs`;
  logToStderr(`Crumbs folder: ${crumbsDir} ${projectHas(crumbsDir) ? "already exists" : "is free"}`);
  const templateDir = join(MAZERATTA_DIR, "templates", framework);
  const libraryDir = join(templateDir, "src", "crumbs");

  const shellFile = `${srcDir}/index.ts`;
  const entryIsIndex = Boolean(entry && INDEX_FILE_NAME.test(basename(entry)));
  const mainEntry = entry && entryIsIndex ? join(dirname(entry), `main${extname(entry)}`) : entry;
  const shellModule = appImport?.[2] ?? `./${FRAMEWORK_FILES[framework].app}`;
  const shellBase = join(srcDir, appImport ? shellModule : FRAMEWORK_FILES[framework].shell);
  const shellFileOnDisk = [shellBase, ...[".tsx", ".jsx", ".ts", ".js", ".svelte"].map((e) => shellBase + e)].find(
    (c) => projectHas(c) && statSync(projectPath(c)).isFile(),
  );
  logToStderr(`App shell: ${shellFileOnDisk ?? "not found"}; its crumb goes in ${shellFile}${entryIsIndex ? `, once ${entry} is renamed to ${mainEntry}` : ""}`);

  return {
    framework,
    metaFramework,
    usesVite,
    version,
    scriptSrc,
    entry,
    srcDir,
    appImport,
    components,
    componentsDir,
    barrel,
    crumbsDir,
    templateDir,
    libraryDir,
    shellFile,
    entryIsIndex,
    mainEntry,
    shellExists: projectHas(shellFile) && shellFile !== entry,
    shellModule,
    shellSrc: repoPath(shellFileOnDisk ?? join(srcDir, FRAMEWORK_FILES[framework].shell)),
    exampleComponentFile: `${componentsDir}/Toolbar${FRAMEWORK_FILES[framework].ext}`,
  };
}

type Stack = Awaited<ReturnType<typeof inspectStack>>;

function importPathToCrumbs(stack: Stack, from: string) {
  const path = relative(from, stack.crumbsDir) || ".";
  return path.startsWith(".") ? path : `./${path}`;
}

function packageScriptCommand(script: string) {
  return `${packageManager} run ${script}`;
}

function facts(stack?: Stack): [string, string][] {
  const rows: [string, string][] = [
    ["project", PROJECT],
    ["git root", gitRoot === PROJECT ? "same as project" : gitRoot],
    ["stacks", found.join(", ") || "none detected"],
  ];
  if (found.length) rows.push(["port status", found.map((f) => `${f} ${PORT_STATUS[f] ?? "beta"}`).join(", ")]);
  if (!stack) return rows;
  rows.push(
    [`${stack.framework} version`, stack.version ?? "unknown"],
    ["meta-framework", stack.metaFramework || "none"],
    ["bundler", stack.usesVite ? "Vite" : stack.metaFramework === "Next.js" || stack.metaFramework === "Create React App" ? "webpack/turbopack" : "not Vite"],
    ["package manager", packageManager],
    ["TypeScript", projectHas("tsconfig.json") ? "yes" : "no (the library is TypeScript)"],
    ["entry", stack.entry ?? "not found"],
    ["app import in entry", stack.appImport ? `${stack.appImport[1]} from "${stack.appImport[2]}"` : "not found"],
    ["components dir", stack.components ?? `none — create ${stack.componentsDir}`],
    ["components barrel", stack.barrel ?? "none"],
  );
  return rows;
}

function blockers(stack: Stack) {
  const list: string[] = [];
  if (!stack.usesVite) {
    list.push(
      `${stack.framework}: no Vite. The overlay compiles out through \`import.meta.env.DEV\`, which ${stack.metaFramework || "this bundler"} does not define, so the vendored folder would throw or ship to production. Ask the user how to proceed (e.g. define \`import.meta.env.DEV\` in the bundler config); do not edit the vendored copy.`,
    );
  }
  if (stack.framework === "svelte" && majorVersion(stack.version) < 5) list.push(`Svelte: version ${stack.version}; the library needs Svelte 5 (runes).`);
  if (stack.framework === "reactjs" && majorVersion(stack.version) < 17) list.push(`React: version ${stack.version}; the library needs React 17+ (automatic JSX runtime).`);
  if (projectHas(stack.crumbsDir)) list.push(`${stack.framework}: ${stack.crumbsDir} already exists. Compare it with ${stack.libraryDir} before replacing it.`);
  return list;
}

function headerSection() {
  const beta = found.filter((f) => PORT_STATUS[f] !== "stable");
  return [
    `# Integrate crumbs into ${basename(PROJECT)}`,
    "",
    `crumbs lets the user point at something (a component in the running UI) and`,
    `leave a note that reaches you, the coding agent, as one line in this session (typed via tmux, or pushed over a channel):`,
    "",
    "```",
    `crumb @ <file> (<functionality>): <instruction>`,
    "```",
    "",
    `Your job now is to wire it into this project. The library lives in mazeratta (\`${MAZERATTA_DIR}\`); this`,
    `project gets a vendored copy of it. Respect the project's own conventions: don't`,
    `restructure it, reformat it or strip its comments. Crumb coarsely first; coverage is refined later`,
    `from the UI. Paths and commands below are relative to \`${PROJECT}\`.`,
    "",
    ...(beta.length
      ? [
          `**${beta.join(", ")} ${beta.length > 1 ? "are" : "is"} in beta**: under test, not yet approved. Tell the user before step 1,`,
          `and report anything in this brief or the library that doesn't work as described, rather than working around it`,
          `silently: those reports are how a port gets approved.`,
          "",
        ]
      : []),
  ];
}

function detectedSection(stack?: Stack) {
  const lines = [`## Detected`, "", `| | |`, `|---|---|`, ...facts(stack).map(([k, v]) => `| ${k} | ${v} |`), ""];
  if (!found.length) lines.push(`No supported stack found. Re-run with \`--as ${FRAMEWORKS.join("|")}\`, or ask the user which part to crumb.`, "");
  if (found.length > 1) {
    lines.push(
      `Several stacks found (${found.join(", ")}). Each would vendor its library into the same \`crumbs/\` and crumb the`,
      `same shell, so crumb one: re-run with \`--as <stack>\` for the part the user wants annotated.`,
      "",
    );
  }
  return lines;
}

function blockersSection(stack: Stack) {
  const list = blockers(stack);
  return list.length ? [`## Blockers — resolve with the user before step 1`, "", ...list.map((b) => `- ${b}`), ""] : [];
}

function stepsSection(stack: Stack) {
  const { framework, componentsDir, crumbsDir } = stack;
  const lines: string[] = [];
  function add(line = "") {
    lines.push(line);
  }
  let step = 1;

  add(`## ${framework}: wire in the UI overlay`);
  add();
  add(`Reference implementation: \`${stack.templateDir}\` (the same wiring in a fresh app).`);
  add();
  add(`${step++}. **Vendor the library.** Copy it verbatim; it is refreshed from mazeratta later, so never edit the copy.`);
  add("   ```bash");
  add(`   cp -R ${stack.libraryDir} ${crumbsDir}`);
  add(`   mkdir -p ${componentsDir} && cp ${join(stack.templateDir, "src", "components", "CLAUDE.md")} ${componentsDir}/CLAUDE.md`);
  add("   ```");
  add(`   If \`${componentsDir}/CLAUDE.md\` already exists, append the file to it instead of overwriting.`);
  add(`   Then read \`${crumbsDir}/CLAUDE.md\` and \`${componentsDir}/CLAUDE.md\`; they are the rules for everything below.`);
  add();
  if (stack.entryIsIndex && stack.mainEntry) {
    add(`${step++}. **Free \`${stack.shellFile}\` for the shell's barrel** by renaming the entry \`${stack.entry}\` to \`${stack.mainEntry}\`:`);
    add("   ```bash");
    add(`   git mv ${stack.entry} ${stack.mainEntry}`);
    add("   ```");
    add(
      stack.scriptSrc === stack.entry
        ? `   and in \`index.html\` change \`src="/${stack.entry}"\` to \`src="/${stack.mainEntry}"\`.`
        : `   and update whatever names it as the entry (\`index.html\`, the Vite config's \`build.rollupOptions.input\`).`,
    );
    add(`   Keep its contents, pragmas included. An \`index.ts\` beside an \`index.tsx\` would make \`"."\` ambiguous.`);
    add();
  }
  const appName = stack.appImport?.[1] ?? "App";
  add(`${step++}. **Crumb the app shell** in the barrel \`${stack.shellFile}\`${stack.shellExists ? " (it exists; add this entry to it)" : ""}:`);
  add("   ```ts");
  add(`   import { withCrumb } from "${importPathToCrumbs(stack, stack.srcDir)}";`);
  add(`   import AppBase from "${stack.shellModule}";`);
  add();
  add(`   export const App = withCrumb(AppBase, { src: "${stack.shellSrc}" });`);
  add("   ```");
  if (stack.mainEntry && stack.appImport)
    add(`   In \`${stack.mainEntry}\`, change \`${stack.appImport[0]}\` to \`import { ${appName === "App" ? "App" : `App as ${appName}`} } from ".";\`.`);
  else if (["SvelteKit", "SolidStart", "Next.js", "Astro"].includes(stack.metaFramework))
    add(`   ${stack.metaFramework} has no single mount point: skip the shell crumb and crumb the root layout's regions instead (next step).`);
  else add(`   The entry's app import wasn't found; find where the root component is mounted and import \`App\` from \`"."\` there.`);
  add();
  const exampleImport =
    framework === "svelte" ? basename(stack.exampleComponentFile) : basename(stack.exampleComponentFile, FRAMEWORK_FILES[framework].ext);
  add(`${step++}. **Crumb the first level of groups, and only that.** Pick the regions you would name (top bar, sidebar,`);
  add(`   main panel) and the components with their own behaviour. For each, add an entry to the barrel`);
  add(`   \`${stack.barrel ?? `${componentsDir}/index.ts`}\`${stack.barrel ? " (it exists; turn its plain re-exports of crumbed components into entries)" : " (create it)"}:`);
  add("   ```ts");
  add(`   import { withCrumb } from "${importPathToCrumbs(stack, componentsDir)}";`);
  add(`   import ToolbarBase from "./${exampleImport}";`);
  add();
  add(`   export const Toolbar = withCrumb(ToolbarBase, { src: "${repoPath(stack.exampleComponentFile)}" });`);
  add("   ```");
  add(`   Then point those components' consumers at the barrel. Component files themselves are not edited.`);
  add(`   A region that is currently inline markup only becomes crumbable once it is its own component file;`);
  add(`   extract it only if that is a small, safe move, otherwise leave it for a later \`+\` request.`);
  add(`   Coverage grows from the running UI: the user clicks \`+\` on a crumb and you add its children then.`);
  if (framework === "svelte") add(`   Two-way \`bind:\` and \`bind:this\` don't pass through a crumbed component: don't crumb a component its parent binds.`);
  add();
  add(`${step++}. **Write every \`src\` relative to the directory the coding agent runs in**, because the note is opened from there.`);
  add(repoPrefix ? `   That is the git root, so every \`src\` starts with \`${repoPrefix}/\` (as above).` : `   That is this project's root (as above).`);
  add();
  add(`${step++}. **Match the overlay's theme.** It is light or dark from \`data-theme="light|dark"\` or a \`.light\`/\`.dark\` class on \`<html>\`,`);
  add(`   otherwise from the OS preference. If the app already sets one of those, nothing to do. If it is dark-only`);
  add(`   (or light-only) with no theme switch, pin it: \`<html data-theme="dark">\` in \`index.html\`, as the templates do.`);
  add(`   If it switches themes some other way, mirror that choice onto \`<html>\` with \`data-theme\`; don't edit \`crumb.css\`.`);
  add();
  add(`${step++}. **Tell future sessions.** Add to the \`CLAUDE.md\` where the agent runs${repoPrefix ? ` (\`${gitRoot}/CLAUDE.md\`)` : ""}, creating it if missing:`);
  add("   ```md");
  add(`   ## crumbs`);
  add();
  add(`   Lines of the form \`crumb @ <file> (<functionality>): <instruction>\` are notes the`);
  add(`   user left on the running UI. Open \`<file>\`, confirm the target from \`<functionality>\`, and carry`);
  add(`   out the instruction there. Rules: \`${repoPath(crumbsDir)}/CLAUDE.md\` (incl. granularity requests) and`);
  add(`   \`${repoPath(componentsDir)}/CLAUDE.md\` (crumbs live in barrels, one per component). \`${repoPath(crumbsDir)}/\` is`);
  add(`   vendored from mazeratta: don't edit it. A granularity request names \`mazeratta crumbs more|fewer\`;`);
  add(`   run it as \`${MAZERATTA_COMMAND} crumbs more|fewer <file>\`.`);
  add("   ```");
  add();
  add(`Done when:`);
  add(`- the project's own typecheck and \`${packageScriptCommand("build")}\` pass;`);
  add(`- \`grep -rlE "crumb-(pencil|gran|popover)" dist\` (or the build's output dir) prints nothing: the overlay compiled out;`);
  add(`- \`${MAZERATTA_COMMAND} verify .\` passes: no component imports crumbs, every barrel is reachable and every \`src\` exists;`);
  add(`- in \`${packageScriptCommand("dev")}\`, hovering a crumbed component shows the ✎.`);
  add();
  return lines;
}

function runLoopSection() {
  const session = currentTmuxSession();
  return [
    `## Run the loop`,
    "",
    `Notes reach the agent one of two ways. Tell the user both once you're done; don't start either yourself.`,
    "",
    `**tmux**: the note is typed into the prompt without Enter, so the user reviews it before sending.`,
    "",
    "```bash",
    `${MAZERATTA_COMMAND} serve ${session || "<this agent's tmux session>"}   # note bridge on :8080`,
    "```",
    `Add \`-submit\` to have the server press Enter, so each note runs without review (it then listens on`,
    `loopback only and accepts only localhost pages).`,
    "",
    `**Claude Code channel**: no tmux; the note goes straight into the session and Claude acts on it at once.`,
    `Claude Code starts the server itself, and \`channel:claude-code\` becomes the default session (tmux sessions`,
    `stay selectable). A research preview: needs claude.ai or Console login, and on Team or Enterprise plans an`,
    `admin must enable channels.`,
    "",
    "```bash",
    `${MAZERATTA_COMMAND} claude --continue   # Claude Code, with the note bridge as its channel`,
    "```",
    `Run it in the project after exiting Claude Code; \`--continue\` resumes this conversation. Nothing is written to`,
    `the project. The startup banner confirms it with "Channels (experimental) messages from server:mazeratta…".`,
    "",
    `Either way the overlay posts to \`http://localhost:8080\`; set \`VITE_API\` when the server runs elsewhere.`,
    "",
  ];
}

function keepLocalSection() {
  return [
    `## Keep it local (if the user doesn't want crumbs committed)`,
    "",
    `Ask the user whether crumbs should be committed or stay a local dev tool. For local, the working tree must`,
    `hold nothing but this integration, so ask them to commit or stash their own changes before step 1. When`,
    `the checks pass, don't commit; run these and tell the user the cycle:`,
    "",
    "```bash",
    `${MAZERATTA_COMMAND} local save .   # keeps every change against HEAD as the local set, in .git`,
    `${MAZERATTA_COMMAND} local auto .   # every commit takes crumbs out first and puts them back after`,
    "```",
    `With auto, the user just commits. Without it: \`${MAZERATTA_COMMAND} off\` before each commit, \`${MAZERATTA_COMMAND} on\` after it.`,
  ];
}

const stack = framework ? await inspectStack(framework) : undefined;
const steps = stack ? stepsSection(stack) : [];
if (stack) logToStderr(`Blockers: ${blockers(stack).length || "none"}`);
logToStderr(stack ? `Brief: ${stepTitles(steps).length} steps` : "Brief: no steps (no single stack)");
const brief = [
  ...headerSection(),
  ...detectedSection(stack),
  ...(stack ? [...blockersSection(stack), ...progressSection(stepTitles(steps)), ...steps] : []),
  ...runLoopSection(),
  ...keepLocalSection(),
];
console.log(brief.join("\n"));
