// Scryfall's raw answers to cards/search, status and body as it sent them, asked through politeFetch (one request
// at a time across every script) and kept gzipped in a folder, a file per request, so a rerun is offline.
// For scripts/test-api.ts, which compares the whole response with scripts/search-api.ts's.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { politeFetch } from "./scryfall-answers.ts";

export const API = "https://api.scryfall.com/";

export type Raw = { url: string, at: number, status: number, body: any };

export class RawAnswers {
    private dir: string;
    private say: (line: string) => void;
    constructor(dir: string, say: (line: string) => void = console.log) {
        this.dir = dir;
        this.say = say;
        mkdirSync(dir, { recursive: true });
    }

    private file(url: string) {
        return join(this.dir, `${createHash("sha1").update(url).digest("hex")}.json.gz`);
    }

    known(url: string): Raw | undefined {
        const f = this.file(url);
        return existsSync(f) ? JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")) : undefined;
    }

    // Scryfall's answer to this url (a full https://api.scryfall.com/… address), from the folder if it's there
    async get(url: string, refresh = false): Promise<Raw> {
        const old = refresh ? undefined : this.known(url);
        if (old) return old;
        const res = await politeFetch(url, { say: this.say });
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = text; }
        const raw: Raw = { url, at: Date.now(), status: res.status, body };
        writeFileSync(this.file(url), gzipSync(JSON.stringify(raw)));
        return raw;
    }
}
