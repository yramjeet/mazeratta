import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runQuiet } from "./util";

export type Kind = "entry" | "barrel" | "import" | "css" | "docs" | "env" | "mcp" | "appended" | "theme" | "mention";
export type Hit = { file: string; line: number; text: string };
export type Traces = {
  files: string[];
  listedByGit: boolean;
  vendored: string[];
  wholeFiles: string[];
  hits: Map<Kind, Hit[]>;
  count: number;
};

const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.svelte-kit|\.next|\.vite)\//;
const SKIP_BUILD_OUTPUT = /^(dist[\w-]*|build|out|target|vendor)\//;
const TEXT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|md|css|scss|html)$|(^|\/)(\.env[\w.]*|\.mcp\.json)$/;
const VITE_CONFIG_FILE = /vite\.config\.\w+$/;
const VENDORED_FILES = ["util.ts", "crumb.css", "CLAUDE.md", "README.md"];
const COMPONENTS_RULE_HEADING = /^# components — pure components, crumbs in the barrel/;

const TRACE_PATTERNS: { kind: Kind; files: RegExp; line: RegExp }[] = [
  { kind: "entry", files: /\.(ts|tsx|js|jsx|svelte)$/, line: /import\s*\{\s*App\b[^}]*\}\s*from\s+["']\.(?:\/index)?["']/ },
  { kind: "barrel", files: /\.(ts|tsx|js|jsx)$/, line: /^\s*export\s+const\s+\w+\s*=\s*withCrumb\(\s*\w+\s*,/ },
  {
    kind: "import",
    files: /\.(ts|tsx|js|jsx|svelte)$/,
    line: /from\s+["'][^"']*\bcrumbs(?:\/index(?:\.\w+)?)?["']|^\s*import\s+["'][^"']*\bcrumbs\//,
  },
  { kind: "css", files: /\.(ts|tsx|js|jsx|svelte|css|scss|html)$/, line: /\bcrumb-(target|active|pencil|popover|pop-|gran)/ },
  { kind: "docs", files: /\.md$/, line: /crumb @|withCrumb|\bcrumbs?\b.*\b(barrel|granularity|overlay|vendored|mazeratta)\b|^#+\s*crumbs\b/i },
  { kind: "mcp", files: /(^|\/)\.mcp\.json$/, line: /"mazeratta"\s*:|-channel"/ },
  { kind: "env", files: /(^|\/)(\.env[\w.]*|vite\.config\.\w+)$/, line: /\bVITE_API\b/ },
  { kind: "theme", files: /(^|\/)index\.html$/, line: /<html\b[^>]*\bdata-theme=/ },
  { kind: "mention", files: /\.(ts|tsx|js|jsx|mjs|cjs|svelte|css|scss|html)$/, line: /\bcrumbs?\b/i },
];

function listProjectFiles(project: string) {
  const listed = runQuiet(["git", "ls-files", "--cached", "--others", "--exclude-standard"], project);
  const candidates = listed
    ? listed.split("\n").filter((f) => existsSync(join(project, f)))
    : [...new Bun.Glob("**/*").scanSync({ cwd: project, onlyFiles: true, dot: true })];
  return {
    files: candidates.filter((f) => !SKIP_DIRS.test(f) && (listed || !SKIP_BUILD_OUTPUT.test(f))).sort(),
    listedByGit: Boolean(listed),
  };
}

function findVendoredFolders(files: string[]) {
  const present = new Set(files);
  const crumbsDirs = new Set(files.filter((f) => basename(dirname(f)) === "crumbs").map(dirname));
  return [...crumbsDirs].filter((dir) => VENDORED_FILES.every((name) => present.has(`${dir}/${name}`)));
}

async function scanFiles(project: string, files: string[], vendored: string[]) {
  const wholeFiles: string[] = [];
  const hits = new Map<Kind, Hit[]>();
  function addHit(kind: Kind, hit: Hit) {
    (hits.get(kind) ?? hits.set(kind, []).get(kind)!).push(hit);
  }
  for (const file of files) {
    if (vendored.some((dir) => file.startsWith(`${dir}/`))) continue;
    if (!TEXT_FILE.test(file) && !VITE_CONFIG_FILE.test(file)) continue;
    const body = await Bun.file(join(project, file)).text();
    if (body.length > 1_000_000) continue;
    const lines = body.split("\n");
    const ruleAt = basename(file) === "CLAUDE.md" ? lines.findIndex((l) => COMPONENTS_RULE_HEADING.test(l)) : -1;
    if (ruleAt === 0) {
      wholeFiles.push(file);
      continue;
    }
    if (ruleAt > 0) {
      addHit("appended", { file, line: ruleAt + 1, text: lines[ruleAt].trim() });
      continue;
    }
    lines.forEach((text, i) => {
      const pattern = TRACE_PATTERNS.find((p) => p.files.test(file) && p.line.test(text));
      if (pattern) addHit(pattern.kind, { file, line: i + 1, text: text.trim() });
    });
  }
  return { wholeFiles, hits };
}

export async function findTraces(project: string): Promise<Traces> {
  const { files, listedByGit } = listProjectFiles(project);
  const vendored = findVendoredFolders(files);
  const { wholeFiles, hits } = await scanFiles(project, files, vendored);
  const count = vendored.length + wholeFiles.length + [...hits.values()].reduce((n, list) => n + list.length, 0);
  return { files, listedByGit, vendored, wholeFiles, hits, count };
}

export function formatHit(hit: Hit) {
  return `\`${hit.file}:${hit.line}\` \`${hit.text.length > 100 ? `${hit.text.slice(0, 97)}...` : hit.text}\``;
}
