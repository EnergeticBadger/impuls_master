// Fuzz test for the "what does the card do" builder: npm run fuzz-rules -- [options]
// It searches Scryfall itself, so it's slow (hours); npm run test-rules checks every block locally in under a
// minute and is the one to run after changing a piece. This one is for what only Scryfall can show.
// First every block the builder can make (and some made of awkward typed words, and searches of several blocks)
// is checked against Scryfall's regex limits without searching. Then a sample is searched on Scryfall, the
// heaviest first, to catch anything it drops, refuses or times out on, and to check the cards it finds match.
//   --sample <n>   how many searches after the heaviest ones (default 1500, about 40 minutes)
//   --all          search every case (days: ~125k searches)
//   --offline      only the limits check, no searches
//   --delay <ms>   wait between searches (default 1200; Scryfall throttles bursts)
//   --max <n>      stop after this many searches (a quick try: --max 10)
//   --seed <n>     which random sample (default 1), so a run can be repeated
//   --out <dir>    where results go (default fuzz-results)
// <out>/results.jsonl gets a line per search as it finishes, so a stopped run picks up where it left off;
// <out>/summary.md lists everything that wasn't fine. Stop it any time with Ctrl+C; the summary is still written.
// While it runs, a status line at the bottom shows how far it's got, time left, and the outcomes so far.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EFFECTS, TARGETS, TRIGGERS, blockToken, type RuleBlock } from "../app/Components/Searchbar/rules.ts";
import { MAX_REGEX_CHARS, MAX_REGEX_DEPTH, MAX_REGEXES, findRegexes, regexDepth } from "../app/Components/Searchbar/regexLimits.ts";

const HEADERS = { "User-Agent": "impuls_master-fuzz/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SAMPLE = Number(option("sample", "1500"));
const DELAY = Number(option("delay", "1200"));
const SEED = Number(option("seed", "1"));
const OUT = resolve(option("out", "fuzz-results"));

// small seeded random numbers, so the same --seed picks the same sample
let state = SEED >>> 0 || 1;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];

type Case = { id: string, kind: "block" | "words" | "several", about: string, query: string };

// words people might type into "To who or what", awkward characters included: each has to come out as a regex
// Scryfall reads the way it's written
const OWN_WORDS = [
    "goblin", "two cards", "can't be blocked", "+1/+1", "{T}", "a/b", "\"quoted\"", "x|y", "(brackets)", "[square]",
    "back\\slash", "~", "50%", "dot.dot", "star*", "plus+", "question?", "caret^", "dollar$", "it's", "Æther",
];

const describe = (b: RuleBlock) => `${b.trigger || "-"} / ${b.effect || "-"} / ${b.words || "-"}`;

function allCases(): Case[] {
    const cases: Case[] = [];
    const triggers = ["", ...TRIGGERS.map((p) => p.value)];
    const effects = ["", ...EFFECTS.map((p) => p.value)];
    for (const trigger of triggers)
        for (const effect of effects)
            for (const words of ["", ...TARGETS.map((p) => p.value)]) {
                const block = { trigger, effect, words };
                const query = blockToken(block);
                if (query) cases.push({ id: `block:${describe(block)}`, kind: "block", about: describe(block), query });
            }
    // typed words, with a few triggers and effects around them
    for (const words of OWN_WORDS)
        for (const trigger of ["", "enters", "your-attack"])
            for (const effect of ["", "destroy", "any-removal", "any-keyword"]) {
                const block = { trigger, effect, words };
                cases.push({ id: `words:${describe(block)}`, kind: "words", about: describe(block), query: blockToken(block) });
            }
    // several blocks and other filters in one search, the way the rules chip joins them (all of them, or any)
    const blocks = cases.filter((c) => c.kind === "block");
    for (let i = 0; i < 400; i++) {
        const parts = Array.from({ length: 2 + Math.floor(random() * 2) }, () => pick(blocks).query);
        const any = random() < 0.5;
        const extra = pick(["", "t:creature ", "c<=r ", "id<=bg f:commander ", "t:equipment "]);
        const query = `${extra}${any ? `(${parts.join(" or ")})` : parts.join(" ")}`;
        cases.push({ id: `several:${i}:${SEED}`, kind: "several", about: `${parts.length} blocks, ${any ? "any" : "all"}${extra ? `, ${extra.trim()}` : ""}`, query });
    }
    return cases;
}

// what's wrong with a search before it's sent: past a limit, or a regex that doesn't compile
function offlineProblems(c: Case): string[] {
    const problems: string[] = [];
    const regexes = findRegexes(c.query);
    // a single block keeps to half the limit, so it leaves room for the rest of a search; several blocks can
    // still go over, which Scryfall refuses (and the search box warns about)
    if (c.kind !== "several" && regexes.length > MAX_REGEXES / 2) problems.push(`${regexes.length} regexes in one block`);
    if (c.kind === "several" && regexes.length > MAX_REGEXES) problems.push(`${regexes.length} regexes in one search (expected: refused, and the search box warns)`);
    for (const re of regexes) {
        if (re.length > MAX_REGEX_CHARS) problems.push(`regex ${re.length} characters`);
        if (regexDepth(re) > MAX_REGEX_DEPTH) problems.push(`regex ${regexDepth(re)} deep`);
        try { new RegExp(re, "i"); } catch (e) { problems.push(`doesn't compile: ${(e as Error).message}`); }
    }
    let depth = 0;
    for (const ch of c.query.replace(/\/(?:\\.|[^/\\])*\//g, "")) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth !== 0) problems.push("brackets don't balance");
    return problems;
}

type Outcome = "cards" | "empty" | "skipped" | "ignored" | "refused" | "error";
type Result = { id: string, kind: Case["kind"], about: string, query: string, outcome: Outcome, cards: number, details?: string, warnings?: string[], mismatch?: string, ms: number };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// one search, retried when Scryfall asks to slow down or has a hiccup
async function search(c: Case): Promise<Result> {
    for (let attempt = 1; ; attempt++) {
        const start = Date.now();
        let status = 0, body: any;
        try {
            const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(c.query)}`, { headers: HEADERS });
            status = r.status;
            body = JSON.parse(await r.text());
        } catch {
            body = undefined;
        }
        const ms = Date.now() - start;
        const base = { id: c.id, kind: c.kind, about: c.about, query: c.query, ms };
        if (status === 429) {
            await wait(90_000, "Scryfall asked to slow down");
            continue;
        }
        if (!body || status >= 500) {
            if (attempt < 3) { await wait(30_000 * attempt, `no answer (HTTP ${status || "none"}), trying again`); continue; }
            return { ...base, outcome: "error", cards: 0, details: `HTTP ${status || "no answer"}` };
        }
        if (status === 404) return { ...base, outcome: "empty", cards: 0 };
        if (status === 400) return { ...base, outcome: /ignored/i.test(body.details ?? "") ? "ignored" : "refused", cards: 0, details: body.details, warnings: body.warnings ?? undefined };
        if (body.object !== "list") return { ...base, outcome: "error", cards: 0, details: body.details ?? `HTTP ${status}` };
        const warnings: string[] = body.warnings ?? [];
        return { ...base, outcome: warnings.length ? "skipped" : "cards", cards: body.total_cards ?? 0, warnings: warnings.length ? warnings : undefined, mismatch: mismatch(c, body.data ?? []) };
    }
}

// a card Scryfall found that none of the block's regexes match here: a sign Scryfall reads one differently.
// Only for a single block, where any one regex matching is enough
function mismatch(c: Case, cards: any[]): string | undefined {
    if (c.kind === "several" || c.query.includes(") o:/")) return undefined;
    const regexes = findRegexes(c.query).map((re) => { try { return new RegExp(re, "i"); } catch { return null; } });
    if (regexes.includes(null)) return undefined;
    for (const card of cards.slice(0, 5)) {
        const texts = [card.oracle_text, ...(card.card_faces ?? []).map((f: any) => f.oracle_text)].filter(Boolean) as string[];
        const name = String(card.name).split(" // ")[0];
        // Scryfall matches the card's own name as ~ too, and a legend's short name ("Baxter" for "Baxter, Fly in the Ointment")
        const short = name.split(",")[0];
        const variants = texts.flatMap((t) => [t, t.split(name).join("~"), t.split(name).join("~").split(short).join("~")]);
        if (!variants.some((t) => regexes.some((re) => re!.test(t)))) return card.name;
    }
    return undefined;
}

// The run's progress: a status line kept at the bottom of the terminal, with each search printed above it.
// Piped to a file there's no bottom to keep it at, so it's printed every 50 searches instead
const live = !!process.stdout.isTTY;
const progress = { done: 0, total: 0, started: Date.now(), waiting: "", results: [] as Result[] };

const duration = (ms: number) => {
    const m = Math.round(ms / 60_000);
    return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

function statusLine(): string {
    const { done, total, started, waiting, results } = progress;
    const share = total ? done / total : 1;
    const width = 20;
    const bar = "█".repeat(Math.round(share * width)).padEnd(width, "░");
    const elapsed = Date.now() - started;
    const left = done ? (elapsed / done) * (total - done) : NaN;
    const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
    const problems = results.filter((r) => !["cards", "empty"].includes(r.outcome) || r.mismatch).length;
    const times = results.map((r) => r.ms).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    return [
        `${bar} ${Math.floor(share * 100)}% ${done.toLocaleString()}/${total.toLocaleString()}`,
        `${duration(elapsed)} in${done >= total ? ", done" : done ? `, ~${duration(left)} left` : ""}`,
        problems ? `⚠ ${problems} to look at` : "no problems yet",
        `cards ${count("cards")} · empty ${count("empty")} · skipped ${count("skipped")} · ignored ${count("ignored")} · refused ${count("refused")} · error ${count("error")}`,
        `median ${median} ms`,
        ...(waiting ? [`waiting: ${waiting}`] : []),
    ].join("  |  ");
}

// the status line, cut to the terminal's width: a line that wraps can't be redrawn in place
function draw() {
    if (!live) return;
    const columns = process.stdout.columns || 120;
    const line = statusLine();
    process.stdout.write(`\r\x1b[2K${line.length > columns - 1 ? `${line.slice(0, columns - 2)}…` : line}`);
}

// a line of log above the status line
function say(line: string) {
    if (live) process.stdout.write(`\r\x1b[2K${line}\n`);
    else console.log(line);
    draw();
}

async function wait(ms: number, why: string) {
    progress.waiting = `${why} (${Math.round(ms / 1000)}s)`;
    if (live) draw(); else console.log(`  waiting ${Math.round(ms / 1000)}s: ${why}`);
    await sleep(ms);
    progress.waiting = "";
    draw();
}

function summarise(cases: Case[], offline: Map<string, string[]>, results: Result[]) {
    const lines: string[] = [`# Rules builder fuzz run`, ``, `${new Date().toISOString()} · seed ${SEED} · ${cases.length.toLocaleString()} cases`, ``];
    if (progress.total) lines.push(`Progress: ${statusLine()}`, ``);
    lines.push(`## Offline limits check`, ``);
    lines.push(offline.size ? `${offline.size} cases break a limit:` : `Every case is within the limits: regexes ≤ ${MAX_REGEX_CHARS} characters and ≤ ${MAX_REGEX_DEPTH} deep, ≤ ${MAX_REGEXES / 2} regexes a block, all compile.`, ``);
    for (const [id, problems] of [...offline].slice(0, 200)) lines.push(`- \`${id}\`: ${problems.join("; ")}`);
    const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
    lines.push(``, `## Searches on Scryfall`, ``, `| Outcome | Searches | Meaning |`, `|---|---|---|`);
    const meanings: Record<Outcome, string> = {
        cards: "found cards", empty: "ran, no card matches (fine)", skipped: "Scryfall dropped part of the search",
        ignored: "Scryfall dropped every term", refused: "Scryfall refused the search", error: "no answer after retries",
    };
    for (const o of Object.keys(meanings) as Outcome[]) lines.push(`| ${o} | ${count(o).toLocaleString()} | ${meanings[o]} |`);
    const mismatches = results.filter((r) => r.mismatch);
    lines.push(``, `${mismatches.length} searches found a card none of their regexes match here.`, ``);
    const bad = results.filter((r) => !["cards", "empty"].includes(r.outcome));
    if (bad.length) lines.push(`## Not fine`, ``);
    for (const r of bad.slice(0, 300)) lines.push(`- **${r.outcome}** ${r.kind} \`${r.about}\` (${r.query.length} chars): ${r.details ?? ""} ${(r.warnings ?? []).join(" ")}`, `  \`${r.query}\``);
    if (mismatches.length) lines.push(``, `## Cards the regex doesn't match here`, ``);
    for (const r of mismatches.slice(0, 100)) lines.push(`- ${r.mismatch} for \`${r.about}\``, `  \`${r.query}\``);
    // Scryfall is slow on some regexes; a search people wait on for seconds is worth knowing about
    const times = results.filter((r) => r.outcome !== "error").map((r) => r.ms).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    lines.push(``, `## Slowest searches`, ``, `Median ${median} ms; ${times.filter((t) => t > 5000).length} took over 5 seconds, ${times.filter((t) => t > 10000).length} over 10.`, ``);
    for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 15)) lines.push(`- ${r.ms} ms, ${r.outcome}: \`${r.about}\``);
    writeFileSync(join(OUT, "summary.md"), lines.join("\n") + "\n");
}

mkdirSync(OUT, { recursive: true });
const cases = allCases();
const offline = new Map<string, string[]>();
for (const c of cases) {
    const problems = offlineProblems(c);
    if (problems.length) offline.set(c.id, problems);
}
console.log(`${cases.length.toLocaleString()} cases; ${offline.size} break a limit before searching`);

const resultsFile = join(OUT, "results.jsonl");
const results: Result[] = existsSync(resultsFile)
    ? readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Result)
    : [];
// errors get another go
const done = new Set(results.filter((r) => r.outcome !== "error").map((r) => r.id));
const kept = results.filter((r) => r.outcome !== "error");

let queue: Case[] = [];
if (!flag("offline")) {
    const todo = cases.filter((c) => !done.has(c.id));
    // the heaviest first: every block that's split, the longest block for each effect, every typed-words case
    const regexCount = (c: Case) => findRegexes(c.query).length;
    const longest = new Map<string, Case>();
    for (const c of todo.filter((c) => c.kind === "block").sort((a, b) => b.query.length - a.query.length)) {
        const effect = c.about.split(" / ")[1];
        if (!longest.has(effect)) longest.set(effect, c);
    }
    const heavy = new Set([...todo.filter((c) => c.kind === "block" && regexCount(c) > 1), ...longest.values(), ...todo.filter((c) => c.kind !== "block")]);
    const rest = todo.filter((c) => !heavy.has(c));
    // shuffle the rest the seeded way
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queue = [...heavy, ...(flag("all") ? rest : rest.slice(0, SAMPLE))].slice(0, Number(option("max", "Infinity")));
    const minutes = Math.round((queue.length * (DELAY + 400)) / 60_000);
    console.log(`${done.size.toLocaleString()} already searched; ${queue.length.toLocaleString()} to go (about ${minutes} minutes)`);
}

let stopping = false;
process.on("SIGINT", () => {
    if (stopping) process.exit(1);
    stopping = true;
    say("Stopping after this search… (Ctrl+C again to quit now)");
});

const fresh: Result[] = [];
// counts include searches from an earlier run this one picked up from; time left is this run's pace
Object.assign(progress, { total: queue.length, started: Date.now(), results: [...kept] });
draw();
for (const [n, c] of queue.entries()) {
    if (stopping) break;
    const r = await search(c);
    fresh.push(r);
    progress.results.push(r);
    progress.done = n + 1;
    appendFileSync(resultsFile, JSON.stringify(r) + "\n");
    const flagged = r.outcome !== "cards" && r.outcome !== "empty" ? `  <-- ${r.outcome}: ${r.details ?? (r.warnings ?? []).join(" ")}` : r.mismatch ? `  <-- found ${r.mismatch}, which the regex doesn't match` : "";
    say(`${String(n + 1).padStart(6)}/${queue.length} ${r.outcome.padEnd(7)} ${String(r.cards).padStart(6)} ${String(r.ms).padStart(6)} ms  ${c.about}${flagged}`);
    if (!live && (n + 1) % 50 === 0) console.log(`\n${statusLine()}\n`);
    if ((n + 1) % 100 === 0) summarise(cases, offline, [...kept, ...fresh]);
    await sleep(DELAY);
}
summarise(cases, offline, [...kept, ...fresh]);
// leave the last status on screen, then the summary's path under it
if (live) process.stdout.write("\n");
else if (queue.length) console.log(statusLine());
console.log(`\nSummary: ${join(OUT, "summary.md")}`);
