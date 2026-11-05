import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { progressSection, stepTitles } from "./report-progress";
import { findTraces, formatHit, type Kind } from "./traces";
import { MAZERATTA_COMMAND, logToStderr, readLocalManifest, runQuiet, type LocalManifest } from "./util";

const usage = `Usage:
  mazeratta remove [project-dir]

Scans the project for every trace crumbs left (vendored folders, imports, barrel
entries, overlay classes, agent docs, VITE_API)
and prints a brief for a coding agent to remove them. Reads only; changes nothing.
Run it again afterwards: it reports nothing when the removal is complete.`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}

const PROJECT = resolve(args[0] ?? ".");
if (!existsSync(PROJECT) || !statSync(PROJECT).isDirectory()) {
  console.error(`Not a directory: ${PROJECT}`);
  process.exit(2);
}
logToStderr(`Checking ${PROJECT}`);

const SHELL_ENTRY = /withCrumb\(\s*AppBase\b/;
const STEP_ORDER: Kind[] = ["entry", "barrel", "import", "css", "docs", "appended", "mention", "theme", "mcp", "env"];

function readLocalSet(): LocalManifest | null {
  const gitDir = runQuiet(["git", "rev-parse", "--absolute-git-dir"], PROJECT);
  if (!gitDir) return null;
  const { manifest, error } = readLocalManifest(gitDir);
  if (error) logToStderr(`Local set: unreadable, ${error}`);
  return manifest;
}

const { files: projectFiles, listedByGit, vendored, wholeFiles, hits, count: traceCount } = await findTraces(PROJECT);
logToStderr(
  listedByGit
    ? `Files: ${projectFiles.length}, listed by git (tracked, and untracked but not ignored)`
    : `Files: ${projectFiles.length}, found by walking the folder (not a git repository; build output skipped)`,
);
const untracked = new Set(runQuiet(["git", "ls-files", "--others", "--exclude-standard"], PROJECT).split("\n").filter(Boolean));
const commits = vendored.length
  ? runQuiet(["git", "log", "--diff-filter=A", "--format=%h %ad %s", "--date=short", "--", ...vendored], PROJECT)
  : "";
const localSet = readLocalSet();
logToStderr(`Vendored crumbs folders: ${vendored.join(", ") || "none"}`);
logToStderr(`Whole files to delete: ${wholeFiles.join(", ") || "none"}`);
logToStderr(
  `Traces: ${STEP_ORDER.filter((kind) => hitsOf(kind).length).map((kind) => `${kind} ${hitsOf(kind).length}`).join(", ") || "none"}`,
);
logToStderr(`Integration commits: ${commits ? commits.split("\n").length : "none found"}`);
logToStderr(`Local set: ${localSet ? localSet.state : "none"}`);

function hitsOf(kind: Kind) {
  return hits.get(kind) ?? [];
}
function foundAny(...kinds: Kind[]) {
  return kinds.some((kind) => hitsOf(kind).length);
}
function hitLines(kind: Kind) {
  return hitsOf(kind).map((hit) => `   - ${formatHit(hit)}`);
}

function headerSection() {
  const lines = [
    `# Remove crumbs from ${basename(PROJECT)}`,
    "",
    `The goal is a project with no trace of crumbs that behaves exactly as before. The overlay was already`,
    `compiled out of production builds, so this is a source cleanup: no runtime behaviour the users see`,
    `should change. Paths below are relative to \`${PROJECT}\`.`,
    "",
  ];
  if (localSet?.state === "on") {
    lines.push(`This integration is kept local (\`mazeratta local\`) and is on, so \`mazeratta off\` takes it out: no manual steps.`);
  } else if (vendored.some((dir) => [...untracked].some((u) => u.startsWith(`${dir}/`)))) {
    lines.push(
      `The integration is not committed: \`git status\` shows its changes, mixed with anything else uncommitted.`,
      `Ask the user before starting: either discard it wholesale (\`git restore\` the modified files, delete the`,
      `untracked ones; this also drops any other uncommitted work, so list what would go), or commit or stash`,
      `first and follow the steps below.`,
    );
  } else {
    lines.push(`Before starting, make sure \`git status\` is clean, so every deletion below can be recovered.`);
  }
  lines.push("");
  return lines;
}

function commitsSection() {
  if (!commits) return [];
  return [
    `## The integration commits`,
    "",
    "```",
    commits,
    "```",
    `If these commits only added crumbs and later work doesn't depend on them, \`git revert\` them, then run`,
    `\`${MAZERATTA_COMMAND} remove .\` again and follow it for whatever was crumbed since. Otherwise work`,
    `through the steps below.`,
    "",
  ];
}

function localSetSection(set: LocalManifest) {
  const lines = [
    `## Kept local (mazeratta local)`,
    "",
    `This integration is a saved local set (currently ${set.state}). The simplest removal is to switch it off`,
    `and forget it, then rerun this brief for anything crumbed after it was saved:`,
    "",
    "```bash",
    ...(set.state === "on" ? [`${MAZERATTA_COMMAND} off .`] : []),
    `${MAZERATTA_COMMAND} local forget .`,
    `${MAZERATTA_COMMAND} local manual .`,
    `${MAZERATTA_COMMAND} remove .`,
    "```",
    "",
  ];
  if (set.state === "on") {
    lines.push(
      `\`off\` restores every file crumbs changed and deletes the files it added; the user's own edits stay. If it refuses`,
      `(an edit overlaps a crumbs change), it has changed nothing: show the user its message and ask how to proceed.`,
      `If it lists leftovers (something crumbed after the save), the rerun of this brief covers them.`,
      "",
    );
  }
  return lines;
}

function stepsSection() {
  const lines = [`## Steps`, ""];
  let step = 0;
  function addStep(title: string, body: string[]) {
    lines.push(`${++step}. **${title}**`, ...body, "");
  }

  if (foundAny("entry")) {
    const shellBarrel = hitsOf("barrel").find((hit) => SHELL_ENTRY.test(hit.text))?.file ?? "src/index.ts";
    addStep(`Mount the app directly again.`, [
      `   Import the app component itself again: the module the shell barrel \`${shellBarrel}\``,
      `   imports as \`AppBase\`, e.g. \`import { App } from "."\` → \`import App from "./App"\`.`,
      `   The barrel's \`withCrumb(AppBase, …)\` entry goes in the next step; delete \`${shellBarrel}\` if that was all it held.`,
      `   The entry may stay \`main.*\`; renaming it back to \`index.*\` is optional.`,
      ...hitLines("entry"),
    ]);
  }
  if (foundAny("barrel")) {
    const created = [...new Set(hitsOf("barrel").map((hit) => hit.file).filter((f) => untracked.has(f)))];
    addStep(`Turn barrel entries back into plain exports.`, [
      `   Each \`export const X = withCrumb(XBase, {…});\` becomes \`export { default as X } from "./X";\` (keep the`,
      `   file extension the \`XBase\` import uses), so consumers keep their imports. If git shows a barrel was`,
      `   created by the integration, repoint its consumers at the component files and delete it instead.`,
      ...(created.length ? [`   Untracked, so created by the integration: ${created.map((f) => `\`${f}\``).join(", ")}.`] : []),
      ...hitLines("barrel"),
    ]);
  }
  if (foundAny("import")) addStep(`Remove the remaining imports of crumbs.`, hitLines("import"));
  if (foundAny("css")) addStep(`Remove app styles that target the overlay's classes.`, hitLines("css"));
  if (foundAny("docs", "appended")) {
    addStep(`Remove crumbs from the agent docs.`, [
      `   Delete the \`## crumbs\` section and any other crumbs rule. Keep the rest; some matches may be`,
      `   unrelated uses of the word, so read each one:`,
      ...hitLines("docs"),
      ...(foundAny("appended")
        ? [
            `   These files had their own rules before the crumbs rules were appended. Delete from this heading to`,
            `   the end of the appended rules (\`git diff\` or \`git log -p\` on the file shows where they end), keep the rest:`,
            ...hitLines("appended"),
          ]
        : []),
    ]);
  }
  if (foundAny("mention")) {
    addStep(`Remove what still mentions crumbs.`, [
      `   Comments, strings or names left by the integration, e.g. a comment explaining an import from the`,
      `   barrel. Read each: a word the project uses for its own feature (its own breadcrumbs) stays.`,
      ...hitLines("mention"),
    ]);
  }
  if (foundAny("theme")) {
    addStep(`Remove the theme pin if the integration added it.`, [
      `   The brief pins \`data-theme\` on \`<html>\` only for a single-theme app with no switch. Check with \`git log -p\``,
      `   or \`git diff\`: drop it if it came with crumbs, keep it if the app's own theme uses it.`,
      ...hitLines("theme"),
    ]);
  }
  if (wholeFiles.length || vendored.length) {
    addStep(`Delete the crumbs files.`, [
      "   ```bash",
      ...wholeFiles.map((f) => `   rm ${f}`),
      ...vendored.map((dir) => `   rm -r ${dir}`),
      "   ```",
      ...(wholeFiles.some((f) => basename(f) === "CLAUDE.md")
        ? [`   A components \`CLAUDE.md\` that also holds the project's own rules keeps them; delete only the crumbs part.`]
        : []),
    ]);
  }
  if (foundAny("mcp")) {
    addStep(`Unregister the mazeratta channel server.`, [
      `   Run \`claude mcp remove mazeratta -s project\` (or delete its entry; delete \`.mcp.json\` if nothing else is in it):`,
      ...hitLines("mcp"),
    ]);
  }
  if (foundAny("env")) addStep(`Remove \`VITE_API\` if nothing else uses it.`, hitLines("env"));
  return lines;
}

function doneSection() {
  return [
    `## Done when`,
    "",
    `- \`${MAZERATTA_COMMAND} remove .\` prints "No crumbs traces found";`,
    `- the project's typecheck, build and tests pass;`,
    `- \`git diff --stat\` touches only what is listed above.`,
    "",
    `Then tell the user they can stop the mazeratta note server, and remove the Claude Code commands with`,
    `\`${MAZERATTA_COMMAND} commands uninstall\` if no other project uses them.`,
  ];
}

function localOnDoneSection() {
  return [
    `## Done when`,
    "",
    `- the rerun prints "No crumbs traces found" and no longer mentions a saved local set;`,
    `- the project's typecheck and build pass, and \`git status\` shows only the user's own changes.`,
  ];
}

if (!traceCount) {
  logToStderr("Brief: nothing to remove");
  console.log(`No crumbs traces found in ${PROJECT}.`);
  if (localSet) console.log(`A saved local set still exists, ${localSet.state}; \`${MAZERATTA_COMMAND} local forget .\` deletes it.`);
  process.exit(0);
}

const localModeRemoves = localSet?.state === "on";
const steps = localModeRemoves ? [] : stepsSection();
logToStderr(localModeRemoves ? "Brief: no steps (local mode takes it out)" : `Brief: ${stepTitles(steps).length} steps`);
const brief = [
  ...headerSection(),
  ...commitsSection(),
  ...(localSet ? localSetSection(localSet) : []),
  ...(localModeRemoves ? localOnDoneSection() : [...progressSection(stepTitles(steps)), ...steps, ...doneSection()]),
];
console.log(brief.join("\n"));
