#!/usr/bin/env bun
import { join } from "node:path";
import { currentTmuxSession } from "./util";

const SCRIPTS_DIR = import.meta.dir;
const SERVER_DIR = join(SCRIPTS_DIR, "..", "server");

const usage = `Usage: mazeratta <command> [options]

Add crumbs to a project
  integrate [dir] [--as solidjs|reactjs|svelte]   print the brief an agent follows to add crumbs
  remove [dir]                                    print the brief to take every trace out again
  commands install|uninstall                      add or remove /crumbs-integrate and /crumbs-remove in Claude Code

Run the note loop
  serve [tmux-session] [-submit] [server flags]   start the server; notes are typed into tmux
                                                  (defaults to the tmux session you run it from;
                                                  -submit presses Enter so each note runs at once)
  claude [claude flags]                           start Claude Code with the server as its channel;
                                                  notes go straight into that session

Keep crumbs out of your commits
  off [dir]                                       take crumbs out before a commit
  on [dir] [--merge]                              put them back after it
  local [command] [dir]                           status, save, resave, auto, manual, forget
                                                  (mazeratta local --help for all of them)

Check
  verify [dir] [--full-coverage] [--no-comments]  check a project's barrels and src paths

Change crumb granularity (what the + and − buttons ask the agent to run)
  crumbs more <file>                              crumb the components <file> imports from a barrel
  crumbs fewer <file>                             uncrumb them again
  check                                           check the templates agree with each other

Every [dir] defaults to the current directory.`;

async function runAndExit(cmd: string[], cwd?: string): Promise<never> {
  const child = Bun.spawn(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await child.exited);
}
function runScriptAndExit(name: string, ...args: string[]) {
  return runAndExit(["bun", join(SCRIPTS_DIR, name), ...args]);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "integrate":
    await runScriptAndExit("integrate-brief.ts", ...args);
  case "remove":
    await runScriptAndExit("remove-brief.ts", ...args);
  case "commands":
    await runScriptAndExit("claude-commands.ts", ...args);
  case "local":
    await runScriptAndExit("local-crumbs.ts", ...args);
  case "on":
  case "off":
    await runScriptAndExit("local-crumbs.ts", command, ...args);
  case "crumbs":
    await runScriptAndExit("granularity.ts", ...args);
  case "verify":
    await runScriptAndExit("verify-crumbs.ts", ...args);
  case "check":
    await runScriptAndExit("check-ports.ts", ...args);
  case "serve": {
    const serverArgs = [...args];
    if (serverArgs[0] && !serverArgs[0].startsWith("-")) serverArgs.splice(0, 1, "-tmux", serverArgs[0]);
    const asksForHelp = serverArgs.some((a) => ["-h", "-help", "--help"].includes(a));
    if (!asksForHelp && !serverArgs.includes("-tmux") && !serverArgs.includes("-channel")) {
      const session = currentTmuxSession();
      if (!session) {
        console.error("Not inside tmux: name the session to type notes into, e.g. mazeratta serve my-session");
        process.exit(2);
      }
      serverArgs.push("-tmux", session);
    }
    await runAndExit(["go", "run", ".", ...serverArgs], SERVER_DIR);
  }
  case "claude": {
    const mcpConfig = { mcpServers: { mazeratta: { command: "go", args: ["-C", SERVER_DIR, "run", ".", "-channel"] } } };
    await runAndExit(["claude", "--mcp-config", JSON.stringify(mcpConfig), "--dangerously-load-development-channels", "server:mazeratta", ...args]);
  }
  case undefined:
  case "help":
  case "-h":
  case "--help":
    console.log(usage);
    process.exit(command ? 0 : 2);
  default:
    console.error(`Unknown command: ${command}\n\n${usage}`);
    process.exit(2);
}
