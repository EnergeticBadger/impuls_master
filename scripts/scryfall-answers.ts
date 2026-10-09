// Scryfall's answers to searches, asked politely and remembered, for the scripts that compare the local search
// with it (test-syntax, test-keys). An answer is kept a week, or until a script asks again with refresh.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HEADERS = { "User-Agent": "impuls_master-tests/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };
const WEEK = 7 * 24 * 3600_000;
// a page holds 175 cards
export const PAGE = 175;

// `cards` is there when the whole answer was fetched: each card's oracle id and name, then the printing Scryfall
// shows it with (id, set, collector number; older answers don't have these). `warnings` when Scryfall ignored
// part of the search
export type Answer = { at: number, total: number, cards?: [string, string, string?, string?, string?][], error?: string, warnings?: string[] };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// thrown instead of waiting when Scryfall asks to slow down and the script was told to stop then, so it can
// share Scryfall with another run (a long fuzz-rules) without pushing on
export class SlowDown extends Error {}

// ---- one request at a time, across every script on this machine ----
// Two scripts asking Scryfall at once got 429s and a warning about a network block, so every request from any
// process goes through a lock in a shared folder: one at a time, GAP apart, and after a 429 everyone waits.
// SCRYFALL_LOCK_DIR moves the folder; SCRYFALL_GAP (ms) changes the gap. SCRYFALL_POLL (ms) is how often a waiting
// script tries the lock: a script that asks again straight away takes the lock back before others' next try, so
// with several running a lower value gets a fairer share (the gap between requests stays the same)
const LOCKS = process.env.SCRYFALL_LOCK_DIR ?? join(homedir(), ".cache", "impuls_master", "scryfall");
const GAP = Number(process.env.SCRYFALL_GAP ?? 1200);
const POLL = Number(process.env.SCRYFALL_POLL ?? 100);
const LOCK = join(LOCKS, "lock"), LAST = join(LOCKS, "last"), PAUSE = join(LOCKS, "pause-until");
const readTime = (file: string) => { try { return Number(readFileSync(file, "utf8")) || 0; } catch { return 0; } };

async function withLock<T>(run: () => Promise<T>): Promise<T> {
    mkdirSync(LOCKS, { recursive: true });
    for (;;) {
        try { mkdirSync(LOCK); break; } catch {
            // a holder that died leaves the lock behind; a request never takes a minute
            try { if (Date.now() - statSync(LOCK).mtimeMs > 60_000) rmSync(LOCK, { recursive: true, force: true }); } catch {}
            await sleep(POLL + Math.random() * 2 * POLL);
        }
    }
    try { return await run(); } finally { rmSync(LOCK, { recursive: true, force: true }); }
}

// fetch from Scryfall's API politely: waits its turn, keeps the gap, and on a 429 pauses every script for 90s
// (or throws SlowDown with `stopOnLimit`). Returns the response once it isn't a 429
export async function politeFetch(url: string, { stopOnLimit = false, say = console.log as (line: string) => void } = {}): Promise<Response> {
    for (;;) {
        const res = await withLock(async () => {
            const wait = Math.max(readTime(PAUSE), readTime(LAST) + GAP) - Date.now();
            if (wait > 0) {
                if (wait > 5000) say(`waiting ${Math.round(wait / 1000)}s for Scryfall`);
                await sleep(wait);
            }
            const r = await fetch(url, { headers: HEADERS });
            writeFileSync(LAST, String(Date.now()));
            if (r.status === 429) writeFileSync(PAUSE, String(Date.now() + 90_000));
            return r;
        });
        if (res.status !== 429) return res;
        if (stopOnLimit) throw new SlowDown("Scryfall asked to slow down");
        say("Scryfall asked to slow down; every script waits 90s");
    }
}

export class Answers {
    private all: Record<string, Answer>;
    private file: string;
    private say: (line: string) => void;
    private stopOnLimit: boolean;
    // `say` reports waiting on Scryfall, so a status line can show it. With `stopOnLimit`, a 429 throws SlowDown
    // instead of waiting and trying again. (`delay` is kept for old callers; the gap is SCRYFALL_GAP now)
    constructor(file: string, say: (line: string) => void = console.log, { stopOnLimit = false }: { delay?: number, stopOnLimit?: boolean } = {}) {
        this.file = file;
        this.say = say;
        this.stopOnLimit = stopOnLimit;
        this.all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    }

    // a search and its options (order, dir, unique, include_extras…) as one key; a plain search is just its text
    private static key(q: string, options: Record<string, string>) {
        const extra = new URLSearchParams(options).toString();
        return extra ? `${q}\u0000${extra}` : q;
    }

    // the answer remembered for a search, if it's fresh and has as much as is asked for
    known(q: string, pages: number, options: Record<string, string> = {}): Answer | undefined {
        const a = this.all[Answers.key(q, options)];
        if (!a || Date.now() - a.at > WEEK) return undefined;
        if (!a.cards && !a.error && a.total <= pages * PAGE) return undefined;
        return a;
    }

    // Scryfall's answer: every card when it fits in `pages` pages (0 for just the count), otherwise the count.
    // `options` are the API's other parameters (order, dir, unique, include_extras…)
    async ask(q: string, pages: number, refresh = false, options: Record<string, string> = {}): Promise<Answer> {
        const known = refresh ? undefined : this.known(q, pages, options);
        if (known) return known;
        const key = Answers.key(q, options);
        const cards: NonNullable<Answer["cards"]> = [];
        let url: string | undefined = `https://api.scryfall.com/cards/search?${new URLSearchParams({ ...options, q })}`;
        let total = 0, warnings: string[] | undefined;
        for (let page = 0; url && page < Math.max(pages, 1); page++) {
            const res = await politeFetch(url, { stopOnLimit: this.stopOnLimit, say: this.say });
            const body: any = await res.json().catch(() => ({ details: `HTTP ${res.status}` }));
            if (res.status === 404) return this.keep(key, { at: Date.now(), total: 0, cards: [] });
            if (!body.data) return this.keep(key, { at: Date.now(), total: 0, error: body.details ?? `HTTP ${res.status}` });
            total = body.total_cards;
            warnings = body.warnings ?? undefined;
            for (const c of body.data) cards.push([c.oracle_id ?? c.card_faces?.[0]?.oracle_id, c.name, c.id, c.set, c.collector_number]);
            if (pages === 0) break;
            url = body.has_more ? body.next_page : undefined;
        }
        return this.keep(key, { at: Date.now(), total, cards: cards.length === total ? cards : undefined, warnings });
    }

    private keep(key: string, a: Answer): Answer {
        this.all[key] = a;
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(this.all));
        return a;
    }
}
