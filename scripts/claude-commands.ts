import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SCRIPTS_DIR = import.meta.dir;
const COMMANDS_DIR = join(homedir(), ".claude/commands");
const INTEGRATE_COMMAND_FILE = join(COMMANDS_DIR, "crumbs-integrate.md");
const REMOVE_COMMAND_FILE = join(COMMANDS_DIR, "crumbs-remove.md");

const usage = `Usage:
  mazeratta commands install
  mazeratta commands uninstall

install writes ${INTEGRATE_COMMAND_FILE} and
${REMOVE_COMMAND_FILE}, so /crumbs-integrate and /crumbs-remove run
the integrate and remove briefs inside any Claude Code session and hand them to the agent.
uninstall deletes those two files.`;

function slashCommandFile(script: string, description: string, hint: string, task: string) {
  return `---
description: ${description}
allowed-tools: Bash(bun ${join(SCRIPTS_DIR, script)}:*)
argument-hint: "${hint}"
---

!\`bun ${join(SCRIPTS_DIR, script)} $ARGUMENTS\`

${task}
`;
}

async function install() {
  mkdirSync(COMMANDS_DIR, { recursive: true });
  await Bun.write(
    INTEGRATE_COMMAND_FILE,
    slashCommandFile(
      "integrate-brief.ts",
      "Wire mazeratta crumbs into this project",
      "[project-dir] [--as solidjs|reactjs|svelte]",
      `Integrate crumbs into this project by following the brief above. Work through
its steps in order, read the rule files it points to before editing, and stop
to ask if it lists a blocker. Finish with its "Done when" checks and report
what you crumbed.`,
    ),
  );
  await Bun.write(
    REMOVE_COMMAND_FILE,
    slashCommandFile(
      "remove-brief.ts",
      "Remove every trace of mazeratta crumbs from this project",
      "[project-dir]",
      `Remove crumbs from this project by following the brief above. If it found
nothing, say so and stop. Work through its steps in order, ask where it says to
ask, and finish with its "Done when" checks. Report what you removed and
anything you left for the user to decide.`,
    ),
  );
  console.log(`Wrote ${INTEGRATE_COMMAND_FILE}\nWrote ${REMOVE_COMMAND_FILE}\nRun /crumbs-integrate or /crumbs-remove in a Claude Code session inside your project`);
}

function uninstall() {
  for (const file of [INTEGRATE_COMMAND_FILE, REMOVE_COMMAND_FILE]) {
    if (existsSync(file)) {
      unlinkSync(file);
      console.log(`Removed ${file}`);
    }
  }
}

const subcommand = process.argv[2];
if (subcommand === "install") await install();
else if (subcommand === "uninstall") uninstall();
else {
  console.log(usage);
  process.exit(subcommand === "-h" || subcommand === "--help" ? 0 : 2);
}
