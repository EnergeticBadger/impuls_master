// Checks backlog task files the way the agent harness reads them (flat `key: value` frontmatter, see
// backlog/README.md), plus the CLAUDE.md line cap: npm run validate. Exit code 1 on any problem.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEYS = new Set(["id", "title", "phase", "priority", "depends_on", "model", "timeout_min", "max_turns", "hold"]);
const MODELS = new Set(["haiku", "sonnet", "opus"]);
export const CLAUDE_MD_MAX_LINES = 100;

export type Meta = Record<string, string>;

export function parseFrontmatter(text: string): { meta: Meta; body: string } | string {
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!m) return "missing --- frontmatter ---";
    const meta: Meta = {};
    for (const line of m[1].split("\n")) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const at = line.indexOf(":");
        if (at < 0) return `bad frontmatter line: ${line}`;
        meta[line.slice(0, at).trim()] = line.slice(at + 1).split(" #")[0].trim();
    }
    return { meta, body: m[2] };
}

// problems with one task file; `ids` are every task id in tasks/ and done/
export function checkTask(file: string, text: string, ids: Set<string>): string[] {
    const parsed = parseFrontmatter(text);
    if (typeof parsed === "string") return [parsed];
    const { meta, body } = parsed;
    const problems: string[] = [];
    for (const key of ["id", "title", "phase"]) if (!meta[key]) problems.push(`missing ${key}`);
    for (const key of Object.keys(meta)) if (!KEYS.has(key)) problems.push(`unknown key: ${key}`);
    if (meta.id && meta.id !== basename(file, ".md")) problems.push(`id ${meta.id} doesn't match the file name`);
    if (meta.phase && !/^P\d$/.test(meta.phase)) problems.push(`phase must be P0..P9: ${meta.phase}`);
    if (meta.model && !MODELS.has(meta.model)) problems.push(`model must be haiku, sonnet or opus: ${meta.model}`);
    for (const key of ["priority", "timeout_min", "max_turns"]) {
        if (meta[key] && !/^\d+$/.test(meta[key])) problems.push(`${key} must be a whole number`);
    }
    if (meta.hold && !["true", "false"].includes(meta.hold)) problems.push("hold must be true or false");
    if (meta.depends_on) {
        if (!/^\[.*\]$/.test(meta.depends_on)) problems.push("depends_on must be a list: [a, b]");
        const deps = meta.depends_on.slice(1, -1).split(",").map((d) => d.trim()).filter(Boolean);
        for (const d of deps) if (!ids.has(d)) problems.push(`depends_on an unknown task: ${d}`);
    }
    for (const section of ["## Goal", "## Acceptance criteria", "## Verify"]) {
        if (!body.includes(section)) problems.push(`missing a "${section}" section`);
    }
    return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const dirs = ["backlog/tasks", "backlog/done"].filter((d) => existsSync(d));
    const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".md")).map((f) => join(d, f)));
    const ids = new Set(files.map((f) => basename(f, ".md")));
    let failed = 0;
    for (const file of files) {
        for (const p of checkTask(file, readFileSync(file, "utf8"), ids)) {
            failed++;
            console.log(`${file}: ${p}`);
        }
    }
    const claudeLines = readFileSync("CLAUDE.md", "utf8").split("\n").length;
    if (claudeLines > CLAUDE_MD_MAX_LINES) {
        failed++;
        console.log(`CLAUDE.md: ${claudeLines} lines, keep it under ${CLAUDE_MD_MAX_LINES} (detail goes in folder CLAUDE.md files)`);
    }
    console.log(failed ? `${failed} problems` : `${files.length} task files OK`);
    process.exit(failed ? 1 : 0);
}
