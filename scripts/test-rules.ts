// Tests the "what does the card do" builder against a local copy of Scryfall's search (scripts/local-search.ts),
// so every block it can make is checked in minutes, without the API: npm run test-rules -- [--out <dir>]
// It checks:
//   - every trigger, effect and target on its own finds cards
//   - no piece has a shape Scryfall reads differently from here: ~ in a group that \b follows
//   - all ~120k blocks, with their card counts; how each count moved since the last run is listed, so a change
//     to a regex shows what it gained or lost
//   - how close the local counts are to Scryfall's, for searches scripts/fuzz-rules.ts has already run
// The card data is Scryfall's bulk files: SCRYFALL_BULK_DIR (oracle_cards.jsonl.gz, oracle_tags.jsonl.gz), or
// downloaded into <out>/bulk once a day. Results go to <out>/local-summary.md (default out: fuzz-results).
// What Scryfall drops, refuses or is slow on can't be seen locally; that's scripts/fuzz-rules.ts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EFFECTS, TARGETS, TRIGGERS, blockToken, type Piece, type RuleBlock } from "../app/Components/Searchbar/rules.ts";
import { Unsupported, bulkFile, loadCards, parse, search, type Cards } from "./local-search.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", "fuzz-results"));
const live = !!process.stdout.isTTY;

function status(label: string, done: number, total: number, started: number) {
    if (!live) return;
    const share = total ? done / total : 1;
    const bar = "█".repeat(Math.round(share * 20)).padEnd(20, "░");
    const elapsed = (Date.now() - started) / 1000;
    const left = done ? Math.round((elapsed / done) * (total - done)) : 0;
    process.stdout.write(`\r\x1b[2K${bar} ${Math.floor(share * 100)}% ${label} ${done.toLocaleString()}/${total.toLocaleString()}  ${Math.round(elapsed)}s in${done < total ? `, ~${left}s left` : ""}`);
}
const endStatus = () => { if (live) process.stdout.write("\n"); };

const started = Date.now();
const cardsPath = await bulkFile("default_cards", join(OUT, "bulk"));
const tagsPath = await bulkFile("oracle_tags", join(OUT, "bulk")).catch(() => undefined);
const data: Cards = await loadCards(cardsPath, tagsPath);
console.log(`${data.cards.length.toLocaleString()} cards and ${data.tags.size.toLocaleString()} tags loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
const count = (q: string, among?: number[]) => search(parse(q), data, among);

const lines: string[] = [`# Rules builder, tested locally`, ``, `${new Date().toISOString()} · ${data.cards.length.toLocaleString()} cards`, ``];
const problems: string[] = [];

// ---- each piece on its own ----

type Kind = "trigger" | "effect" | "target";
const pieceBlock = (kind: Kind, p: Piece): RuleBlock => ({ trigger: kind === "trigger" ? p.value : "", effect: kind === "effect" ? p.value : "", words: kind === "target" ? p.value : "" });
const pieces: { kind: Kind, p: Piece }[] = [
    ...TRIGGERS.map((p) => ({ kind: "trigger" as const, p })),
    ...EFFECTS.map((p) => ({ kind: "effect" as const, p })),
    ...TARGETS.map((p) => ({ kind: "target" as const, p })),
];
// the cards each piece finds alone, as a bitmap: a block's cards are always among each of its pieces'
const alone = new Map<string, Uint8Array>();
const pieceCounts: Record<string, number> = {};
for (const { kind, p } of pieces) {
    const hits = count(blockToken(pieceBlock(kind, p)));
    const map = new Uint8Array(data.cards.length);
    for (const i of hits) map[i] = 1;
    alone.set(`${kind}:${p.value}`, map);
    pieceCounts[`${kind}:${p.value}`] = hits.length;
    if (!hits.length) problems.push(`${kind} “${p.label}” finds no cards`);
}

// a group with ~ in it that \b follows: in Scryfall's text "this creature" is ~ and no \b follows a ~, so
// `untap (this|~)\b` matches nothing there, not even "untap this creature"
function tildeBeforeBoundary(re: string): boolean {
    const open: number[] = [];
    for (let i = 0; i < re.length; i++) {
        if (re[i] === "\\") { i++; continue; }
        if (re[i] === "(") open.push(i);
        else if (re[i] === ")") {
            const start = open.pop() ?? 0;
            if (re.slice(start + 1, i).split("|").includes("~") && re.startsWith("\\b", i + 1)) return true;
        }
    }
    return false;
}
for (const { kind, p } of pieces) if (tildeBeforeBoundary(p.re)) problems.push(`${kind} “${p.label}” has ~ in a group followed by \\b, which Scryfall fails outright`);

// ---- every block ----

const OWN_WORDS = ["goblin", "two cards", "can't be blocked", "+1/+1", "{T}", "a/b", "x|y", "(brackets)", "~", "it's"];
type Block = RuleBlock & { own?: boolean };
const blocks: Block[] = [];
for (const t of ["", ...TRIGGERS.map((p) => p.value)])
    for (const e of ["", ...EFFECTS.map((p) => p.value)])
        for (const w of ["", ...TARGETS.map((p) => p.value)])
            if (t || e || w) blocks.push({ trigger: t, effect: e, words: w });
for (const w of OWN_WORDS) for (const t of ["", "enters"]) for (const e of ["", "destroy", "any-removal"]) blocks.push({ trigger: t, effect: e, words: w, own: true });

const about = (b: RuleBlock) => `${b.trigger || "-"} / ${b.effect || "-"} / ${b.words || "-"}`;
const all = data.cards.map((_, i) => i);

// the cards worth testing a block on: those every one of its pieces finds alone
function candidates(b: Block): number[] {
    if (b.own) return all;
    const maps = [b.trigger && alone.get(`trigger:${b.trigger}`), b.effect && alone.get(`effect:${b.effect}`), b.words && alone.get(`target:${b.words}`)]
        .filter((m): m is Uint8Array => !!m);
    return all.filter((i) => maps.every((m) => m[i]));
}

const blockCounts: Record<string, number> = {};
const blockStart = Date.now();
let unsupported = 0;
for (const [n, b] of blocks.entries()) {
    try {
        blockCounts[about(b)] = count(blockToken(b), candidates(b)).length;
    } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        unsupported++;
        problems.push(`block ${about(b)} can't be read here: ${e.message}`);
    }
    if (n % 500 === 0) status("blocks", n, blocks.length, blockStart);
}
status("blocks", blocks.length, blocks.length, blockStart);
endStatus();

// the shortcut must never change an answer: a sample checked against every card
let shortcutWrong = 0;
for (let k = 0; k < 150; k++) {
    const b = blocks[Math.floor((k * 7919) % blocks.length)];
    if (b.own) continue;
    const full = count(blockToken(b)).length;
    if (full !== blockCounts[about(b)]) { shortcutWrong++; problems.push(`block ${about(b)}: ${blockCounts[about(b)]} with the shortcut, ${full} checking every card`); }
}

// ---- against the last run ----

const countsFile = join(OUT, "local-counts.json");
const before: { pieces: Record<string, number>, blocks: Record<string, number> } | null = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, "utf8")) : null;
writeFileSync(countsFile, JSON.stringify({ pieces: pieceCounts, blocks: blockCounts }));

// ---- against Scryfall ----

type FuzzResult = { query: string, outcome: string, cards: number, about: string };
const fuzzFile = join(OUT, "results.jsonl");
const compared: { about: string, query: string, local: number, scryfall: number }[] = [];
if (existsSync(fuzzFile)) {
    for (const line of readFileSync(fuzzFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as FuzzResult;
        if (r.outcome !== "cards" && r.outcome !== "empty") continue;
        try { compared.push({ about: r.about, query: r.query, local: count(r.query).length, scryfall: r.cards }); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
    }
}

// ---- the summary ----

lines.push(`## Problems`, ``, problems.length ? problems.slice(0, 200).map((p) => `- ${p}`).join("\n") : "None.", ``);

lines.push(`## Pieces`, ``, `| Piece | Cards | Since last run |`, `|---|---|---|`);
for (const [key, n] of Object.entries(pieceCounts)) {
    const was = before?.pieces[key];
    lines.push(`| ${key} | ${n.toLocaleString()} | ${was === undefined ? "new" : n === was ? "" : `${n > was ? "+" : ""}${n - was}`} |`);
}

const counts = Object.values(blockCounts);
lines.push(``, `## Blocks`, ``, `${counts.length.toLocaleString()} blocks in ${((Date.now() - blockStart) / 1000).toFixed(0)}s; ${counts.filter((n) => n === 0).length.toLocaleString()} find no cards (fine for an odd combination); ${unsupported} couldn't be read; the shortcut was checked on a sample and was ${shortcutWrong ? `WRONG ${shortcutWrong} times` : "right every time"}.`, ``);
if (before) {
    const moved = Object.entries(blockCounts).filter(([k, n]) => before.blocks[k] !== undefined && before.blocks[k] !== n)
        .map(([k, n]) => ({ k, n, was: before.blocks[k] })).sort((a, b) => Math.abs(b.n - b.was) - Math.abs(a.n - a.was));
    lines.push(`### Changed since the last run`, ``, moved.length ? `${moved.length.toLocaleString()} blocks find a different number of cards. The biggest moves:` : "No block's count changed.", ``);
    for (const m of moved.slice(0, 40)) lines.push(`- \`${m.k}\`: ${m.was} → ${m.n} (${m.n > m.was ? "+" : ""}${m.n - m.was})`);
    lines.push(``);
}

lines.push(`## Local against Scryfall`, ``);
if (!compared.length) lines.push(`No Scryfall results to compare with yet: run \`npm run fuzz-rules\` first (it writes ${fuzzFile}).`);
else {
    const exact = compared.filter((c) => c.local === c.scryfall).length;
    const close = compared.filter((c) => Math.abs(c.local - c.scryfall) <= Math.max(2, c.scryfall * 0.02)).length;
    // a small, steady gap is cards Scryfall hides that the bulk file doesn't mark; a big one is worth a look
    const far = compared.filter((c) => Math.abs(c.local - c.scryfall) > 5 && Math.abs(c.local - c.scryfall) > c.scryfall * 0.05)
        .sort((a, b) => Math.abs(b.local - b.scryfall) - Math.abs(a.local - a.scryfall));
    lines.push(`${compared.length.toLocaleString()} searches compared: ${exact.toLocaleString()} exact, ${close.toLocaleString()} within 2%, ${far.length} off by more than 5% and 5 cards.`, ``);
    if (far.length) lines.push(`The biggest gaps: a regex Scryfall reads differently, or cards it hides. Scryfall's counts are from when fuzz-rules ran, so a piece changed since then shows up here too.`, ``);
    for (const f of far.slice(0, 40)) lines.push(`- \`${f.about}\`: local ${f.local}, Scryfall ${f.scryfall}`, `  \`${f.query}\``);
}

writeFileSync(join(OUT, "local-summary.md"), lines.join("\n") + "\n");
console.log(`${problems.length ? `${problems.length} problems` : "No problems"}; ${compared.length ? `${compared.length.toLocaleString()} searches compared with Scryfall; ` : ""}took ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`Summary: ${join(OUT, "local-summary.md")}`);
process.exitCode = problems.length ? 1 : 0;
