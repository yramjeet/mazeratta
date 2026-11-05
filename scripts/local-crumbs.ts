import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findTraces, formatHit } from "./traces";
import { MAZERATTA_COMMAND, localManifestFile, localStoreDir, logToStderr, plural, readLocalManifest, type LocalManifest } from "./util";

const SELF_SCRIPT = join(import.meta.dir, "local-crumbs.ts");
const BUN_BINARY = process.execPath;
const HOOK_MARK = "mazeratta local-crumbs.ts auto";

const usage = `Usage: mazeratta local [command] [project-dir]

Keep crumbs out of your commits: integrate once (${MAZERATTA_COMMAND} integrate), then save.
Every change against HEAD at that moment becomes the local set, kept in .git
where it is never committed or pushed. Take it out before a commit, put it back after.

  status          what is saved and whether crumbs are on (the default)
  save            keep the integration as the local set
  resave          take the tree as it is now as the set (crumbs on, nothing else changed)
  off             take crumbs out of the working tree, before a commit (also: ${MAZERATTA_COMMAND} off)
  on [--merge]    put them back, after it (also: ${MAZERATTA_COMMAND} on); --merge merges lines HEAD also changed
  auto            take crumbs out before every commit and put them back after, by itself
                  (installs git's pre-commit and post-commit hooks)
  manual          remove those hooks; back to off and on by hand
  forget          delete the saved set (crumbs must be off)

[project-dir] defaults to the current directory.`;

type Command = { run: () => Promise<void> | void; flags?: string[] };

function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

const COMMANDS: Record<string, Command> = {
  status: { run: status },
  save: { run: () => save(false) },
  resave: { run: () => save(true) },
  off: { run: off },
  on: { run: on, flags: ["--merge"] },
  auto: { run: auto },
  manual: { run: manual },
  forget: { run: forget },
  "pre-commit": { run: preCommit },
  "post-commit": { run: postCommit },
};

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
function pickCommand(first: string | undefined) {
  if (first === undefined || first.startsWith("-")) return "status";
  if (first in COMMANDS) return first;
  if (existsSync(first) && statSync(first).isDirectory()) return "status";
  fail(`Unknown command: ${first}\n\n${usage}`, 2);
}
const commandName = pickCommand(args[0]);
const command = COMMANDS[commandName];
const rest = commandName === args[0] ? args.slice(1) : args;
const flags = rest.filter((a) => a.startsWith("-"));
const unknownFlags = flags.filter((f) => !(command.flags ?? []).includes(f));
if (unknownFlags.length) {
  fail(`Unknown option for ${commandName}: ${unknownFlags.join(", ")}${command.flags ? ` (it takes ${command.flags.join(", ")})` : ""}\n\n${usage}`, 2);
}
const positional = rest.filter((a) => !a.startsWith("-"));
if (positional.length > 1) fail(`One project directory at most\n\n${usage}`, 2);

const start = resolve(positional[0] ?? ".");
if (!existsSync(start) || !statSync(start).isDirectory()) fail(`Not a directory: ${start}`, 2);

function runIn(cwd: string, cmd: string[]) {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, out: result.stdout.toString(), err: result.stderr.toString().trim() };
}

const topLevel = runIn(start, ["git", "rev-parse", "--show-toplevel"]);
if (!topLevel.ok) fail(`Not inside a git repository: ${start}`, 2);
const REPO_ROOT = topLevel.out.trim();
function git(...a: string[]) {
  return runIn(REPO_ROOT, ["git", ...a]);
}
const GIT_DIR = git("rev-parse", "--absolute-git-dir").out.trim();
const STORE_DIR = localStoreDir(GIT_DIR);
const MANIFEST_FILE = localManifestFile(GIT_DIR);
const PATCH_FILE = join(STORE_DIR, "tracked.patch");
const FILES_DIR = join(STORE_DIR, "files");
const AUTO_OFF_FILE = join(STORE_DIR, "taken-out-for-commit");
const HOOK_NAMES = ["pre-commit", "post-commit"];
function hookFile(name: string) {
  return resolve(REPO_ROOT, git("rev-parse", "--git-path", `hooks/${name}`).out.trim());
}

function nonEmptyLines(s: string) {
  return s.split("\n").filter(Boolean);
}
function loadManifest() {
  const { manifest, error } = readLocalManifest(GIT_DIR);
  if (error) fail(`The saved set is unreadable: ${error}\nIf the set is lost, ${MAZERATTA_COMMAND} local forget deletes the store; integrate and save again.`);
  return manifest;
}
function requireManifest() {
  return loadManifest() ?? fail(`Nothing saved here. Integrate (${MAZERATTA_COMMAND} integrate), then: ${MAZERATTA_COMMAND} local save`);
}
async function saveManifest(manifest: LocalManifest) {
  logToStderr(`Writing the manifest: crumbs ${manifest.state}`);
  await Bun.write(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
}
function headCommit() {
  return git("rev-parse", "HEAD").out.trim();
}
function shortSha(sha: string) {
  return sha.slice(0, 8);
}
function untrackedPaths() {
  return nonEmptyLines(git("ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory").out);
}
function isPatchEmpty() {
  return !existsSync(PATCH_FILE) || statSync(PATCH_FILE).size === 0;
}
function manifestCovers(manifest: LocalManifest, path: string) {
  return manifest.tracked.includes(path) || manifest.files.some((f) => (f.endsWith("/") ? path.startsWith(f) : path === f));
}
function isOurHook(name: string) {
  return existsSync(hookFile(name)) && readFileSync(hookFile(name), "utf8").includes(HOOK_MARK);
}
function autoInstalled() {
  return HOOK_NAMES.every(isOurHook);
}
function stagedPaths() {
  return nonEmptyLines(git("diff", "--cached", "--name-only").out);
}

async function traceLines() {
  const traces = await findTraces(REPO_ROOT);
  return [
    ...[...traces.hits.values()].flat().map((hit) => `   - ${formatHit(hit)}`),
    ...[...traces.wholeFiles, ...traces.vendored].map((path) => `   rm ${path}`),
  ];
}

function snapshotUntracked(entries: string[]) {
  for (const f of entries) {
    const from = join(REPO_ROOT, f);
    if (!existsSync(from)) continue;
    const to = join(FILES_DIR, f);
    rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
}

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|svelte)$/;
const RELATIVE_IMPORT_SPECIFIER = /(?:from\s+|import\s*\(?\s*)["'](\.{1,2}\/[^"']*)["']/g;
const IMPORT_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".svelte", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function danglingImports(removed: string[], evenIfPresent = false) {
  function wasRemoved(p: string) {
    return removed.some((f) => (f.endsWith("/") ? `${p}/`.startsWith(f) || p.startsWith(f) : p === f));
  }
  const dangling: string[] = [];
  for (const f of nonEmptyLines(git("ls-files", "--cached", "--others", "--exclude-standard").out)) {
    if (!CODE_FILE.test(f) || !existsSync(join(REPO_ROOT, f))) continue;
    readFileSync(join(REPO_ROOT, f), "utf8")
      .split("\n")
      .forEach((text, i) => {
        for (const importMatch of text.matchAll(RELATIVE_IMPORT_SPECIFIER)) {
          const base = join(dirname(f), importMatch[1]);
          const hit = IMPORT_SUFFIXES.map((e) => base + e).find((c) => wasRemoved(c) && (evenIfPresent || !existsSync(join(REPO_ROOT, c))));
          if (hit) dangling.push(`   - \`${f}:${i + 1}\` imports \`${importMatch[1]}\`, which is ${hit}, ${evenIfPresent ? "part of crumbs" : "removed"}`);
        }
      });
  }
  return dangling;
}

function changedFiles() {
  return nonEmptyLines(git("diff", "--name-status", "HEAD").out).map((l) => {
    const [code, path] = l.split("\t");
    return `  ${code.startsWith("D") ? "deleted " : code.startsWith("A") ? "added   " : "modified"}  ${path}`;
  });
}

function capturePatch() {
  const diff = git("diff", "--binary", "HEAD");
  if (!diff.ok) fail(diff.err);
  return { patch: diff.out, tracked: nonEmptyLines(git("diff", "--name-only", "HEAD").out) };
}

async function status() {
  const manifest = loadManifest();
  if (!manifest) {
    const inTree = (await findTraces(REPO_ROOT)).count > 0;
    console.log(inTree ? `No saved set. Crumbs are in the tree; keep them local with: ${MAZERATTA_COMMAND} local save` : `No saved set, and no crumbs in the tree.`);
    return;
  }
  console.log(`Crumbs are ${manifest.state}. Saved ${manifest.saved} against ${shortSha(manifest.base)}; HEAD is ${shortSha(headCommit())}.`);
  console.log(`The set: ${plural(manifest.tracked.length, "modified file", "modified files")}, ${plural(manifest.files.length, "new path", "new paths")}; stored in ${STORE_DIR}`);
  if (autoInstalled()) console.log(`Automatic: on. Commits take crumbs out and put them back by themselves.`);
  else console.log(`Automatic: off (${MAZERATTA_COMMAND} local auto turns it on).`);
  if (manifest.state === "off" && existsSync(AUTO_OFF_FILE)) console.log(`Crumbs were taken out for a commit that didn't finish. Put them back: ${MAZERATTA_COMMAND} on`);
  else if (!autoInstalled()) console.log(manifest.state === "on" ? `Before a commit: ${MAZERATTA_COMMAND} off` : `After the commit: ${MAZERATTA_COMMAND} on`);
}

async function save(again: boolean) {
  const previous = loadManifest();
  if (previous && !again) fail(`A set is already saved. Take the tree as it is now with ${MAZERATTA_COMMAND} local resave, or delete the set with ${MAZERATTA_COMMAND} local forget.`);
  if (again && !previous) fail(`Nothing saved yet: ${MAZERATTA_COMMAND} local save`);
  if (again && previous!.state === "off") fail(`Crumbs are off. Put them back first (${MAZERATTA_COMMAND} on), then: ${MAZERATTA_COMMAND} local resave`);
  if (!git("rev-parse", "--verify", "-q", "HEAD").ok) fail("The repository has no commit yet; commit once before saving.");
  logToStderr(`Looking for crumbs traces in ${REPO_ROOT}`);
  if (!(await findTraces(REPO_ROOT)).count) fail(`No crumbs in the working tree: integrate first (${MAZERATTA_COMMAND} integrate), then save.`);
  if (again && existsSync(FILES_DIR)) {
    logToStderr(`Clearing the previous snapshot of new paths`);
    rmSync(FILES_DIR, { recursive: true, force: true });
  }
  const staged = !git("diff", "--cached", "--quiet").ok;
  if (staged) {
    logToStderr(`Unstaging the index, so a staged rename is saved as a delete plus a new file`);
    git("reset", "-q");
  }
  const { patch, tracked } = capturePatch();
  logToStderr(`Capturing tracked.patch: ${plural(tracked.length, "modified file", "modified files")}`);
  const files = untrackedPaths();
  logToStderr(`Snapshotting ${plural(files.length, "new path", "new paths")}: ${files.join(", ") || "none"}`);
  mkdirSync(FILES_DIR, { recursive: true });
  await Bun.write(PATCH_FILE, patch);
  snapshotUntracked(files);
  await saveManifest({ state: "on", base: headCommit(), saved: new Date().toISOString(), files, tracked });
  console.log(`${again ? "Re-saved" : "Saved"} the integration as the local set.`);
  console.log(`\nEvery change against HEAD (${shortSha(headCommit())}) is now treated as crumbs:`);
  for (const l of changedFiles()) console.log(l);
  for (const f of files) console.log(`  new       ${f}`);
  console.log(`\nIf anything above is your own work: ${MAZERATTA_COMMAND} local forget, commit or stash that work, and save again.`);
  console.log(`Have every commit take crumbs out and put them back by itself: ${MAZERATTA_COMMAND} local auto`);
  console.log(`Or by hand: ${MAZERATTA_COMMAND} off before a commit, ${MAZERATTA_COMMAND} on after it.`);
}

function checkTakeOut(manifest: LocalManifest) {
  if (isPatchEmpty()) return;
  logToStderr(`Checking tracked.patch reverses cleanly (${plural(manifest.tracked.length, "modified file", "modified files")})`);
  const check = git("apply", "-R", "--check", PATCH_FILE);
  if (!check.ok)
    fail(
      `Can't take the saved changes back out cleanly; nothing was changed.\n${check.err}\n\n` +
        `A file crumbs modified was edited where the crumbs changes are. Undo that overlap, or remove crumbs\n` +
        `by hand with the brief from: ${MAZERATTA_COMMAND} remove .`,
    );
}

async function takeOut(manifest: LocalManifest) {
  logToStderr(`Re-snapshotting ${plural(manifest.files.length, "new path", "new paths")}, so edits made since the save are kept`);
  snapshotUntracked(manifest.files);
  if (!isPatchEmpty()) {
    logToStderr(`Reversing tracked.patch`);
    const result = git("apply", "-R", PATCH_FILE);
    if (!result.ok) fail(`Reversing tracked.patch failed after its check passed; no new path was removed yet.\n${result.err}`);
  }
  logToStderr(`Removing ${manifest.files.join(", ") || "no new paths"}`);
  for (const f of manifest.files) rmSync(join(REPO_ROOT, f), { recursive: true, force: true });
  await saveManifest({ ...manifest, state: "off" });
}

function checkPutBack(manifest: LocalManifest, merge: boolean) {
  const missing = manifest.files.filter((f) => !existsSync(join(FILES_DIR, f)));
  if (missing.length) {
    fail(`The saved snapshot is incomplete; nothing was changed. Missing from ${FILES_DIR}:\n${missing.map((f) => `  ${f}`).join("\n")}\nRestore them from a backup, or: ${MAZERATTA_COMMAND} local forget, then integrate again.`);
  }
  const clash = manifest.files.filter((f) => existsSync(join(REPO_ROOT, f)));
  if (clash.length) fail(`These paths exist already; move them away first, then ${MAZERATTA_COMMAND} on:\n${clash.map((f) => `  ${f}`).join("\n")}`);
  if (isPatchEmpty()) return true;
  logToStderr(`Checking tracked.patch applies cleanly (${plural(manifest.tracked.length, "modified file", "modified files")})`);
  const fits = git("apply", "--check", PATCH_FILE).ok;
  if (!fits && !merge)
    fail(
      `The saved changes no longer fit the files they modified (HEAD changed the same lines); nothing was changed.\n\n` +
        `Merge them, with conflict markers where they clash: ${MAZERATTA_COMMAND} on --merge\nOr start over: ${MAZERATTA_COMMAND} local forget, then integrate again.`,
    );
  return fits;
}

async function putBack(manifest: LocalManifest, merge: boolean) {
  const fits = checkPutBack(manifest, merge);
  const clean = git("status", "--porcelain").out.trim() === "";
  if (!isPatchEmpty() && !fits) {
    logToStderr(`Merging tracked.patch with git apply --3way`);
    const result = git("apply", "--3way", PATCH_FILE);
    console.log(result.ok ? `Merged.` : `Merged with conflicts:\n${result.err}`);
    console.log(`Resolve any conflicts, run \`git reset -q\` to unstage, then take the result as the set: ${MAZERATTA_COMMAND} local resave`);
  } else if (!isPatchEmpty()) {
    logToStderr(`Applying tracked.patch`);
    const result = git("apply", PATCH_FILE);
    if (!result.ok) fail(`Applying tracked.patch failed after its check passed:\n${result.err}`);
  }
  logToStderr(`Restoring ${manifest.files.join(", ") || "no new paths"}`);
  for (const f of manifest.files) cpSync(join(FILES_DIR, f), join(REPO_ROOT, f), { recursive: true });
  let next: LocalManifest = { ...manifest, state: "on" };
  if (clean && fits) {
    const { patch, tracked } = capturePatch();
    logToStderr(`Re-capturing tracked.patch against HEAD ${shortSha(headCommit())}`);
    await Bun.write(PATCH_FILE, patch);
    next = { ...next, base: headCommit(), tracked };
  }
  await saveManifest(next);
  rmSync(AUTO_OFF_FILE, { force: true });
  console.log(`Crumbs on: re-applied ${plural(manifest.tracked.length, "file", "files")}, restored ${plural(manifest.files.length, "new path", "new paths")}.`);
  if (next.base !== manifest.base) console.log(`The set now applies to ${shortSha(next.base)}, the new HEAD.`);
}

async function off() {
  const manifest = requireManifest();
  if (manifest.state === "off") fail(`Crumbs are already off. After the commit: ${MAZERATTA_COMMAND} on`, 0);
  checkTakeOut(manifest);
  await takeOut(manifest);
  console.log(`Crumbs off: reverted ${plural(manifest.tracked.length, "file", "files")}, removed ${plural(manifest.files.length, "new path", "new paths")}.`);
  logToStderr(`Looking for anything crumbs left behind`);
  const left = [...(await traceLines()), ...danglingImports(manifest.files)];
  if (left.length) {
    console.log(`\nStill in the tree (changes made after save, e.g. a new consumer pointed at a barrel):`);
    for (const l of left) console.log(l);
    console.log(`Fix these before committing; the project's typecheck catches imports through path aliases too.`);
    console.log(`To keep such a change as part of crumbs instead: ${MAZERATTA_COMMAND} on, commit your own work first, then ${MAZERATTA_COMMAND} local resave.`);
  }
  console.log(`\nCommit, then: ${MAZERATTA_COMMAND} on`);
}

async function on() {
  const manifest = requireManifest();
  if (manifest.state === "on") fail(`Crumbs are already on. Before a commit: ${MAZERATTA_COMMAND} off`, 0);
  await putBack(manifest, flags.includes("--merge"));
}

async function stagedCrumbsLeftovers(manifest: LocalManifest, staged: string[]) {
  const ownStaged = new Set(staged.filter((path) => !manifestCovers(manifest, path)));
  const traces = await findTraces(REPO_ROOT);
  const traceHits = [...traces.hits.values()].flat().filter((hit) => ownStaged.has(hit.file)).map((hit) => `   - ${formatHit(hit)}`);
  const imports = danglingImports(manifest.files, true).filter((line) => [...ownStaged].some((path) => line.startsWith(`   - \`${path}:`)));
  return [...traceHits, ...imports];
}

async function preCommit() {
  const manifest = loadManifest();
  if (!manifest || manifest.state === "off") return;
  logToStderr(`mazeratta: crumbs are on; taking them out of this commit`);
  const staged = stagedPaths();
  const stagedTracked = manifest.tracked.filter((path) => staged.includes(path));
  checkTakeOut(manifest);
  for (const path of stagedTracked) {
    if (!git("apply", "-R", "--cached", "--check", `--include=${path}`, PATCH_FILE).ok) {
      fail(`The staged ${path} no longer holds the crumbs changes as saved; nothing was changed and the commit was stopped.\nStage it again after ${MAZERATTA_COMMAND} off, or commit with --no-verify to skip this.`);
    }
  }
  const leftovers = await stagedCrumbsLeftovers(manifest, staged);
  if (leftovers.length) {
    fail(`The commit was stopped; nothing was changed. These staged files still use crumbs, so the commit would break without them:\n${leftovers.join("\n")}\nUnstage them, or move the change into crumbs (${MAZERATTA_COMMAND} local resave after committing your own work).`);
  }
  await takeOut(manifest);
  logToStderr(`Unstaging crumbs: ${[...manifest.files, ...stagedTracked].join(", ") || "nothing staged"}`);
  if (manifest.files.length) git("rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", ...manifest.files);
  for (const path of stagedTracked) git("apply", "-R", "--cached", `--include=${path}`, PATCH_FILE);
  await Bun.write(AUTO_OFF_FILE, new Date().toISOString() + "\n");
}

async function postCommit() {
  if (!existsSync(AUTO_OFF_FILE)) return;
  const manifest = loadManifest();
  if (!manifest || manifest.state === "on") {
    rmSync(AUTO_OFF_FILE, { force: true });
    return;
  }
  logToStderr(`mazeratta: putting crumbs back after the commit`);
  await putBack(manifest, false);
}

async function auto() {
  const foreign = HOOK_NAMES.filter((name) => existsSync(hookFile(name)) && !isOurHook(name));
  if (foreign.length) {
    fail(
      `These hooks exist already; add the line to each, then run this again:\n` +
        foreign.map((name) => `  ${hookFile(name)}:\n    "${BUN_BINARY}" "${SELF_SCRIPT}" ${name} || exit 1`).join("\n"),
    );
  }
  if (autoInstalled()) fail("Automatic is already on.", 0);
  for (const name of HOOK_NAMES) {
    const file = hookFile(name);
    mkdirSync(dirname(file), { recursive: true });
    await Bun.write(file, `#!/bin/sh\n# ${HOOK_MARK}\nexec "${BUN_BINARY}" "${SELF_SCRIPT}" ${name}\n`);
    chmodSync(file, 0o755);
    logToStderr(`Installed ${file}`);
  }
  console.log(`Automatic on: every commit takes crumbs out first and puts them back after. git commit --no-verify skips it.`);
}

function manual() {
  const ours = HOOK_NAMES.filter(isOurHook);
  if (!ours.length) fail("Automatic isn't on.", 0);
  for (const name of ours) {
    const file = hookFile(name);
    if (readFileSync(file, "utf8").trim().split("\n").length > 3) {
      console.log(`${file} holds more than this hook; remove the local-crumbs.ts line by hand.`);
      continue;
    }
    unlinkSync(file);
    logToStderr(`Removed ${file}`);
  }
  console.log(`Automatic off: take crumbs out with ${MAZERATTA_COMMAND} off before a commit, and back with ${MAZERATTA_COMMAND} on after.`);
}

function forget() {
  const { manifest, error } = readLocalManifest(GIT_DIR);
  if (!manifest && !error) fail("Nothing saved here.", 0);
  if (manifest?.state === "on") fail(`Crumbs are on. Take them out first (${MAZERATTA_COMMAND} off), or remove them for good with the brief from: ${MAZERATTA_COMMAND} remove .`);
  logToStderr(`Deleting ${STORE_DIR}`);
  rmSync(STORE_DIR, { recursive: true, force: true });
  console.log(`Forgot the saved set. The working tree is unchanged.`);
}

await command.run();
