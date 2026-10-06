// A small local copy of Scryfall's card search, run over its bulk files, so the rules builder can be tested
// in minutes without the API. It covers the syntax the search bar writes, not all of Scryfall's:
//   o: oracle: fo: (rules text; regex, quoted or plain)   t: type:   name: (and bare words)
//   c: color: id: identity: (letters or a count, with : = <= >= < >)   f: format: legal:
//   mv: cmc: (numbers)   kw: keyword:   otag: oracletag: function: (Tagger tags, with their child tags)
//   and, or, -not and brackets.
// Anything else throws Unsupported, so a test can skip it rather than get it wrong.
// What it can't tell you is what Scryfall itself drops, refuses or is slow on: those are Scryfall's limits,
// checked by scripts/fuzz-rules.ts.
// Counts come out within about 1% of Scryfall's. The gap left is mostly cards Scryfall hides that the bulk
// file doesn't mark (Alchemy's specialize variants, some novelty promos), and a few regexes Scryfall reads
// differently (it fails `(this|~)\b` outright); scripts/test-rules.ts compares the two and lists big gaps.

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { join } from "node:path";

const HEADERS = { "User-Agent": "impuls_master-tests/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };

export class Unsupported extends Error {}

export type LocalCard = {
    oracleId: string,
    name: string,
    // rules text as o: sees it, a face each: the card's own name as ~, reminder text left out
    text: string[],
    // as fo: sees it: reminder text kept
    fullText: string[],
    types: string,
    colors: Set<string>,
    identity: Set<string>,
    legal: Set<string>,
    keywords: Set<string>,
    mv: number,
    // the printing the bulk file picked for this card
    set: string,
    setType: string,
};

// not cards Scryfall's search shows by default
const EXTRAS = new Set(["token", "double_faced_token", "emblem", "art_series", "planar", "scheme", "vanguard"]);

const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

function toCard(c: any): LocalCard | null {
    // playtest cards (Mystery Booster's, the Unknown Event's) are hidden from searches too
    if (EXTRAS.has(c.layout) || c.promo_types?.includes("playtest")) return null;
    const faces: any[] = c.card_faces?.length ? c.card_faces : [c];
    const fullName: string = c.name;
    // the card's names, longest first, become ~: the whole name, each face's, and a legend's short name
    // ("Baxter" in "Baxter, Fly in the Ointment", "Círdan" in "Círdan the Shipwright")
    const own: string[] = [fullName, ...faces.map((f) => f.name)];
    const legend = /legendary/i.test(c.type_line ?? faces[0]?.type_line ?? "");
    const short = own.flatMap((n) => [n.split(",")[0], ...(legend ? [n.split(/ (?:the|of) /)[0]] : [])]);
    const names = [...new Set([...own, ...short])].filter((n) => n && n.length > 2).sort((a, b) => b.length - a.length);
    const self = names.length ? new RegExp(names.map(escapeRe).join("|"), "g") : null;
    const raw = faces.map((f) => (f.oracle_text ?? c.oracle_text ?? "") as string);
    const tilde = (t: string) => self ? t.replace(self, "~") : t;
    const letters = (list?: string[]) => new Set((list ?? []).map((l) => l.toLowerCase()));
    return {
        oracleId: c.oracle_id ?? faces[0]?.oracle_id,
        name: fullName,
        text: raw.map((t) => tilde(t.replace(/ ?\([^)]*\)/g, ""))),
        fullText: raw.map(tilde),
        types: (c.type_line ?? faces.map((f) => f.type_line).join(" // ")).toLowerCase(),
        colors: letters(c.colors ?? faces.flatMap((f) => f.colors ?? [])),
        identity: letters(c.color_identity),
        legal: new Set(Object.entries(c.legalities ?? {}).filter(([, v]) => v === "legal" || v === "restricted").map(([k]) => k)),
        keywords: new Set((c.keywords ?? []).map((k: string) => k.toLowerCase())),
        mv: c.cmc ?? 0,
        set: c.set,
        setType: c.set_type,
    };
}

async function* jsonLines(path: string) {
    const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) if (line.trim()) yield JSON.parse(line);
}

// the bulk file of this type: from SCRYFALL_BULK_DIR (as <type>.jsonl.gz, like scripts/card-data.ts), or
// downloaded into `cache` and kept a day, since Scryfall rebuilds them daily
export async function bulkFile(type: "oracle_cards" | "oracle_tags", cache: string): Promise<string> {
    const local = process.env.SCRYFALL_BULK_DIR;
    if (local) return join(local, `${type}.jsonl.gz`);
    const path = join(cache, `${type}.jsonl.gz`);
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < 24 * 3600_000) return path;
    mkdirSync(cache, { recursive: true });
    const list = await (await fetch("https://api.scryfall.com/bulk-data", { headers: HEADERS })).json() as { data: { type: string, jsonl_download_uri?: string }[] };
    const url = list.data.find((f) => f.type === type)?.jsonl_download_uri;
    if (!url) throw new Error(`Scryfall has no ${type} bulk file`);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    return path;
}

export type Cards = { cards: LocalCard[], tags: Map<string, Set<string>> };

// every card, and each Tagger tag's cards (a tag's cards include its child tags', as on Scryfall)
export async function loadCards(cardsPath: string, tagsPath?: string): Promise<Cards> {
    const cards: LocalCard[] = [];
    for await (const c of jsonLines(cardsPath)) {
        const card = toCard(c);
        if (card) cards.push(card);
    }
    const tags = new Map<string, Set<string>>();
    if (tagsPath && existsSync(tagsPath)) {
        const byId = new Map<string, { slug: string, children: string[], cards: string[] }>();
        for await (const t of jsonLines(tagsPath)) {
            byId.set(t.id, { slug: t.slug, children: t.child_ids ?? [], cards: (t.taggings ?? []).map((g: any) => g.oracle_id) });
        }
        const gather = (id: string, into: Set<string>, seen: Set<string>) => {
            if (seen.has(id)) return;
            seen.add(id);
            const t = byId.get(id);
            if (!t) return;
            for (const o of t.cards) into.add(o);
            for (const child of t.children) gather(child, into, seen);
        };
        for (const [id, t] of byId) {
            const into = new Set<string>();
            gather(id, into, new Set());
            tags.set(t.slug, into);
        }
    }
    return { cards, tags };
}

// ---- the query language ----

type Term = { key: string, op: string, value: string, regex?: RegExp };
export type Node = { and: Node[] } | { or: Node[] } | { not: Node } | { term: Term };

const OPS = ["<=", ">=", "!=", ":", "=", "<", ">"];

function tokenize(q: string): (string | Term)[] {
    const out: (string | Term)[] = [];
    let i = 0;
    while (i < q.length) {
        const ch = q[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === "(" || ch === ")") { out.push(ch); i++; continue; }
        if (ch === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) { out.push("-"); i++; continue; }
        const key = /^[a-z]+/i.exec(q.slice(i))?.[0] ?? "";
        const op = key ? OPS.find((o) => q.startsWith(o, i + key.length)) : undefined;
        if (key && op) {
            let j = i + key.length + op.length;
            let value = "", regex: RegExp | undefined;
            if (q[j] === "/") {
                let end = j + 1;
                while (end < q.length && q[end] !== "/") end += q[end] === "\\" ? 2 : 1;
                const body = q.slice(j + 1, end);
                try { regex = new RegExp(body, "i"); } catch (e) { throw new Unsupported(`regex doesn't compile here: ${(e as Error).message}`); }
                value = body;
                j = end + 1;
            } else if (q[j] === "\"") {
                const end = q.indexOf("\"", j + 1);
                value = q.slice(j + 1, end < 0 ? q.length : end);
                j = end < 0 ? q.length : end + 1;
            } else {
                const m = /^[^\s()]*/.exec(q.slice(j))![0];
                value = m;
                j += m.length;
            }
            out.push({ key: key.toLowerCase(), op, value, regex });
            i = j;
            continue;
        }
        // a bare word: `or`, or part of the name
        if (ch === "\"") {
            const end = q.indexOf("\"", i + 1);
            out.push({ key: "name", op: ":", value: q.slice(i + 1, end < 0 ? q.length : end) });
            i = end < 0 ? q.length : end + 1;
            continue;
        }
        const word = /^[^\s()]+/.exec(q.slice(i))![0];
        out.push(/^or$/i.test(word) ? "or" : /^and$/i.test(word) ? "and" : { key: "name", op: ":", value: word });
        i += word.length;
    }
    return out;
}

export function parse(q: string): Node {
    const tokens = tokenize(q);
    let at = 0;
    const expr = (): Node => {
        const any: Node[] = [all()];
        while (tokens[at] === "or") { at++; any.push(all()); }
        return any.length === 1 ? any[0] : { or: any };
    };
    const all = (): Node => {
        const parts: Node[] = [];
        while (at < tokens.length && tokens[at] !== ")" && tokens[at] !== "or") {
            if (tokens[at] === "and") { at++; continue; }
            parts.push(one());
        }
        if (!parts.length) throw new Unsupported("empty group");
        return parts.length === 1 ? parts[0] : { and: parts };
    };
    const one = (): Node => {
        const t = tokens[at++];
        if (t === "-") return { not: one() };
        if (t === "(") {
            const inner = expr();
            if (tokens[at++] !== ")") throw new Unsupported("a bracket isn't closed");
            return inner;
        }
        if (typeof t === "string") throw new Unsupported(`unexpected ${t}`);
        return { term: t };
    };
    const node = expr();
    if (at < tokens.length) throw new Unsupported(`unexpected ${String(tokens[at])}`);
    return node;
}

const COLOR_WORDS: Record<string, string> = { white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c" };

function compare(op: string, a: number, b: number) {
    switch (op) {
        case ":": case "=": return a === b;
        case "!=": return a !== b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
    }
    return false;
}

// a card's colors against the asked ones; `colon` is what a bare `:` means for this key
function colorTest(have: Set<string>, op: string, value: string, colon: string): boolean {
    if (/^\d+$/.test(value)) return compare(op === ":" ? "=" : op, have.size, Number(value));
    const v = COLOR_WORDS[value.toLowerCase()] ?? value.toLowerCase();
    if (!/^[wubrgc]+$/.test(v)) throw new Unsupported(`color ${value}`);
    const want = new Set(v === "c" ? [] : [...v]);
    const sub = [...have].every((c) => want.has(c));
    const sup = [...want].every((c) => have.has(c));
    switch (op === ":" ? colon : op) {
        case "=": return sub && sup;
        case "<=": return sub;
        case ">=": return sup;
        case "<": return sub && !sup;
        case ">": return sup && !sub;
        case "!=": return !(sub && sup);
    }
    return false;
}

function matcher(t: Term, tags: Cards["tags"]): (c: LocalCard) => boolean {
    const text = (get: (c: LocalCard) => string[]) => {
        if (t.op !== ":" && t.op !== "=") throw new Unsupported(`${t.key}${t.op}`);
        if (t.regex) { const re = t.regex; return (c: LocalCard) => get(c).some((s) => re.test(s)); }
        const v = t.value.toLowerCase();
        return (c: LocalCard) => get(c).some((s) => s.toLowerCase().includes(v));
    };
    switch (t.key) {
        case "o": case "oracle": return text((c) => c.text);
        case "fo": case "fulloracle": return text((c) => c.fullText);
        case "t": case "type": return text((c) => [c.types]);
        case "name": return text((c) => [c.name]);
        case "c": case "color": return (c) => colorTest(c.colors, t.op, t.value, ">=");
        case "id": case "identity": case "ci": return (c) => colorTest(c.identity, t.op, t.value, "<=");
        case "f": case "format": case "legal": { const f = t.value.toLowerCase(); return (c) => c.legal.has(f); }
        case "mv": case "cmc": { const n = Number(t.value); if (Number.isNaN(n)) throw new Unsupported(`mv ${t.value}`); return (c) => compare(t.op, c.mv, n); }
        case "kw": case "keyword": { const k = t.value.toLowerCase(); return (c) => c.keywords.has(k); }
        case "otag": case "oracletag": case "function": {
            const cards = tags.get(t.value.toLowerCase());
            if (!tags.size) throw new Unsupported("otag without the tags file");
            return (c) => !!cards?.has(c.oracleId);
        }
    }
    throw new Unsupported(`${t.key}${t.op}`);
}

// the cards (as indexes into `cards`) among `among` that match: an AND only tests what's left after the parts
// before it, so a narrow part first saves the rest a lot of work
export function search(node: Node, data: Cards, among?: number[]): number[] {
    const all = among ?? data.cards.map((_, i) => i);
    if ("term" in node) {
        const test = matcher(node.term, data.tags);
        return all.filter((i) => test(data.cards[i]));
    }
    if ("and" in node) return node.and.reduce((left, part) => left.length ? search(part, data, left) : left, all);
    if ("or" in node) {
        const hit = new Set<number>();
        for (const part of node.or) for (const i of search(part, data, all)) hit.add(i);
        return all.filter((i) => hit.has(i));
    }
    const out = new Set(search(node.not, data, all));
    return all.filter((i) => !out.has(i));
}
