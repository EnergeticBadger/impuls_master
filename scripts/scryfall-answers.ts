// Scryfall's answers to searches, asked politely and remembered, for the scripts that compare the local search
// with it (test-syntax, test-keys). An answer is kept a week, or until a script asks again with refresh.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const HEADERS = { "User-Agent": "impuls_master-tests/1.0 (+https://github.com/EnergeticBadger/impuls_master)", Accept: "application/json" };
const WEEK = 7 * 24 * 3600_000;
// a page holds 175 cards
export const PAGE = 175;

// `cards` (oracle id and name) is there when the whole answer was fetched, `warnings` when Scryfall ignored
// part of the search
export type Answer = { at: number, total: number, cards?: [string, string][], error?: string, warnings?: string[] };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// thrown instead of waiting when Scryfall asks to slow down and the script was told to stop then, so it can
// share Scryfall with another run (a long fuzz-rules) without pushing on
export class SlowDown extends Error {}

export class Answers {
    private all: Record<string, Answer>;
    private file: string;
    private say: (line: string) => void;
    private delay: number;
    private stopOnLimit: boolean;
    // `say` reports waiting on Scryfall, so a status line can show it. `delay` is the wait after each request;
    // with `stopOnLimit`, a 429 throws SlowDown instead of waiting and trying again
    constructor(file: string, say: (line: string) => void = console.log, { delay = 1200, stopOnLimit = false } = {}) {
        this.file = file;
        this.say = say;
        this.delay = delay;
        this.stopOnLimit = stopOnLimit;
        this.all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    }

    // the answer remembered for a search, if it's fresh and has as much as is asked for
    known(q: string, pages: number): Answer | undefined {
        const a = this.all[q];
        if (!a || Date.now() - a.at > WEEK) return undefined;
        if (!a.cards && !a.error && a.total <= pages * PAGE) return undefined;
        return a;
    }

    // Scryfall's answer: every card when it fits in `pages` pages (0 for just the count), otherwise the count
    async ask(q: string, pages: number, refresh = false): Promise<Answer> {
        const known = refresh ? undefined : this.known(q, pages);
        if (known) return known;
        const cards: [string, string][] = [];
        let url: string | undefined = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}`;
        let total = 0, warnings: string[] | undefined;
        for (let page = 0; url && page < Math.max(pages, 1); page++) {
            const res = await fetch(url, { headers: HEADERS });
            if (res.status === 429 && this.stopOnLimit) throw new SlowDown("Scryfall asked to slow down");
            if (res.status === 429) { this.say("Scryfall asked to slow down; waiting 90s"); await sleep(90_000); page--; continue; }
            const body: any = await res.json().catch(() => ({ details: `HTTP ${res.status}` }));
            await sleep(this.delay);
            if (res.status === 404) return this.keep(q, { at: Date.now(), total: 0, cards: [] });
            if (!body.data) return this.keep(q, { at: Date.now(), total: 0, error: body.details ?? `HTTP ${res.status}` });
            total = body.total_cards;
            warnings = body.warnings ?? undefined;
            for (const c of body.data) cards.push([c.oracle_id ?? c.card_faces?.[0]?.oracle_id, c.name]);
            if (pages === 0) break;
            url = body.has_more ? body.next_page : undefined;
        }
        return this.keep(q, { at: Date.now(), total, cards: cards.length === total ? cards : undefined, warnings });
    }

    private keep(q: string, a: Answer): Answer {
        this.all[q] = a;
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(this.all));
        return a;
    }
}
