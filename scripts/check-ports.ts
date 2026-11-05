import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_DIR = join(import.meta.dir, "..");
const TEMPLATES_DIR = join(REPO_DIR, "templates");
const STATUS_FILE = "templates/status.json";
const VALID_STATUSES = ["beta", "stable"];
const SHARED_FILES = ["util.ts", "crumb.css"];
const README_STATUS_LINE = /\*\*Status: (\w+)\.\*\*/;
const SOURCE_FILE = /\.(ts|tsx|svelte)$/;
const STYLES_IMPORT = `"./crumb.css"`;
const PORT_FILES =["src/crumbs/README.md", "src/crumbs/CLAUDE.md", "src/components/CLAUDE.md"];

const problems: string[] = [];

async function readRepoFile(repoPath: string) {
  const file = Bun.file(join(REPO_DIR, repoPath));
  return (await file.exists()) ? file.text() : null;
}

async function readPortStatus(): Promise<Record<string, string> | null> {
  const text = await readRepoFile(STATUS_FILE);
  if (text === null) {
    problems.push(`${STATUS_FILE}: Missing`);
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    problems.push(`${STATUS_FILE}: Not an object of port names to statuses`);
  } catch (error) {
    problems.push(`${STATUS_FILE}: Not valid JSON (${(error as Error).message})`);
  }
  return null;
}

function templateDirs() {
  return readdirSync(TEMPLATES_DIR).filter((name) => statSync(join(TEMPLATES_DIR, name)).isDirectory());
}

async function checkPort(port: string, status: string | undefined, statusKnown: boolean, hasDir: boolean) {
  if (statusKnown) {
    if (status === undefined) problems.push(`${STATUS_FILE}: No status for templates/${port}`);
    else if (!VALID_STATUSES.includes(status)) problems.push(`${STATUS_FILE}: Port ${port} is "${status}", expected ${VALID_STATUSES.join(" or ")}`);
  }
  if (!hasDir) {
    problems.push(`${STATUS_FILE}: Port ${port} has no templates/${port}`);
    return;
  }
  for (const file of PORT_FILES) {
    if ((await readRepoFile(`templates/${port}/${file}`)) === null) problems.push(`templates/${port}/${file}: Missing`);
  }
  const crumbsDir = join(TEMPLATES_DIR, port, "src/crumbs");
  const sources = readdirSync(crumbsDir).filter((name) => !SHARED_FILES.includes(name) && SOURCE_FILE.test(name));
  let importsStyles = false;
  for (const name of sources) if ((await Bun.file(join(crumbsDir, name)).text()).includes(STYLES_IMPORT)) importsStyles = true;
  if (!importsStyles) problems.push(`templates/${port}/src/crumbs: Nothing imports ${STYLES_IMPORT}, so the pencil and popover are unstyled`);
  const readme = await readRepoFile(`templates/${port}/src/crumbs/README.md`);
  const shown = readme?.match(README_STATUS_LINE)?.[1];
  if (readme !== null && status !== undefined && shown !== status) {
    problems.push(`templates/${port}/src/crumbs/README.md: Shows status ${shown ?? "none"}, ${STATUS_FILE} says ${status}`);
  }
}

async function checkSharedFiles(ports: string[]) {
  for (const file of SHARED_FILES) {
    const copies: { port: string; text: string }[] = [];
    for (const port of ports) {
      const text = await readRepoFile(`templates/${port}/src/crumbs/${file}`);
      if (text === null) problems.push(`templates/${port}/src/crumbs/${file}: Missing (shared across the ports)`);
      else copies.push({ port, text });
    }
    for (const { port, text } of copies.slice(1)) {
      if (text !== copies[0].text) {
        problems.push(`templates/${port}/src/crumbs/${file}: Differs from templates/${copies[0].port}/src/crumbs/${file} (shared across the ports)`);
      }
    }
  }
}

const portStatus = await readPortStatus();
const dirs = templateDirs();
const ports = [...new Set([...dirs, ...Object.keys(portStatus ?? {})])].sort();
for (const port of ports) await checkPort(port, portStatus?.[port], portStatus !== null, dirs.includes(port));
await checkSharedFiles(ports.filter((port) => dirs.includes(port)));

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `OK — ${SHARED_FILES.length} files shared across ${ports.length} ports, ` +
    `status: ${Object.entries(portStatus ?? {}).map(([port, status]) => `${port} ${status}`).join(", ")}`,
);
