// Scryfall's API answered from its bulk files, for everything but search: catalogs, cards by name, by set and
// collector number and by id, rulings, autocomplete and sets. Each answer is what Scryfall would send, status and
// body, checked against Scryfall request by request (npm run test-lookups).
//
// Nothing here needs Node: the data is built ahead (scripts/lookups-build.ts) into plain files, and a Store reads
// them, from disk in a script or from R2 in a Worker. A lookup reads index.json once and then one or two small files.
//
//   const lookups = await Lookups.open(store)
//   const res = await lookups.get("cards/named?fuzzy=ligtning bolt")   // { status: 200, body: "{\"object\":\"card\",…" }
//
// get() answers undefined for what it can't answer from the data, so the caller can ask Scryfall instead: another
// endpoint, a card in another language when the build had no all_cards file.

export const CATALOG_NAMES = [
    "card-names", "artist-names", "word-bank", "supertypes", "card-types", "artifact-types", "battle-types",
    "creature-types", "enchantment-types", "land-types", "planeswalker-types", "spell-types", "powers",
    "toughnesses", "loyalties", "watermarks", "keyword-abilities", "keyword-actions", "ability-words", "flavor-words",
] as const;

// one name a printing has, and what has it
export type NameEntry = {
    name: string,
    // a card with more than one face: each face's name
    faces: string[],
    // in catalog/card-names: a card, not a token or an art card
    card: boolean,
    // only on art series cards
    art: boolean,
    // a search shows it without include:extras (see extraKind in scripts/local-search.ts)
    visible: boolean,
    oracles: string[],
    // every printing with this name in default_cards
    prints: string[],
};

export type Index = {
    built: string,
    // whether the build had all_cards, so every language is here
    languages: boolean,
    catalogs: Record<string, string[]>,
    names: NameEntry[],
    // oracle id → the printing Scryfall shows the card with
    shown: Record<string, string>,
    // each set's code and id, in Scryfall's order
    sets: [string, string][],
    // each set's printings in default_cards that aren't variations
    setCounts: Record<string, number>,
};

// reads one of the built files as text; undefined when there's no such file
export interface Store {
    read(path: string): Promise<string | undefined>,
}

export type Answer = { status: number, body: string };

// which cards/ file a card is in
export const cardKey = (id: string) => id.slice(0, 3);

// A name as Scryfall compares names: case, accents and punctuation ignored ("Adewale, Breaker of Chains" is
// Adéwalé, "runners bane" is Runner's Bane, "goblin" is _____ Goblin), words kept apart
const LETTERS: Record<string, string> = { "æ": "ae", "œ": "oe", "ø": "o", "ß": "ss", "đ": "d", "ł": "l", "þ": "th", "ð": "d", "ı": "i" };
export function fold(name: string) {
    return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[æœøßđłþðı]/g, (c) => LETTERS[c])
        .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// what matching needs of a name, worked out once
type Folded = { e: NameEntry, full: string, faces: string[], compact: string };

// of names that match as well, the one Scryfall gives: a card before a token
function best(hits: Folded[]): NameEntry | undefined {
    return (hits.find((f) => f.e.card) ?? hits[0])?.e;
}

const API = "https://api.scryfall.com/";

// Scryfall's errors come pretty-printed (two spaces), unlike everything else
function error(status: number, details: string, type?: string): Answer {
    const body: Record<string, unknown> = { object: "error", code: status === 404 ? "not_found" : "bad_request" };
    if (type) body.type = type;
    body.status = status;
    body.details = details;
    return { status, body: JSON.stringify(body, null, 2) };
}
const NOT_FOUND = () => error(404, "The requested object or REST method was not found.");
const NO_CARD = () => error(404, "No card found with the given ID or set code and collector number.");

export class Lookups {
    private files = new Map<string, Promise<string | undefined>>();
    private store: Store;
    readonly index: Index;
    private folded: Folded[];

    private constructor(store: Store, index: Index) {
        this.store = store;
        this.index = index;
        this.folded = index.names.map((e) => {
            const full = fold(e.name);
            return { e, full, faces: e.faces.map(fold), compact: full.replace(/ /g, "") };
        });
    }

    static async open(store: Store): Promise<Lookups> {
        const text = await store.read("index.json");
        if (!text) throw new Error("no index.json: run scripts/lookups-build.ts");
        return new Lookups(store, JSON.parse(text));
    }

    // a built file, read once
    private read(path: string) {
        let p = this.files.get(path);
        if (!p) {
            p = this.store.read(path);
            this.files.set(path, p);
        }
        return p;
    }

    // the request as the API takes it, "cards/named?fuzzy=…", with or without https://api.scryfall.com/
    async get(request: string): Promise<Answer | undefined> {
        const url = new URL(request.startsWith(API) ? request : API + request.replace(/^\//, ""));
        const parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
        const params = url.searchParams;
        if (parts[parts.length - 1] === "") parts.pop();

        if (parts[0] === "catalog" && parts.length === 2) return this.catalog(parts[1]);
        if (parts[0] === "sets") {
            if (parts.length === 1) return this.allSets();
            if (parts.length === 2) return this.set(parts[1]);
            return undefined;
        }
        if (parts[0] !== "cards") return undefined;
        if (parts.length === 2 && parts[1] === "named") return this.named(params);
        if (parts.length === 2 && parts[1] === "autocomplete") return this.autocomplete(params);
        if (parts.length === 2 && /^[0-9a-f-]{36}$/i.test(parts[1])) return this.byId(parts[1]);
        if (parts.length === 3 && /^[0-9a-f-]{36}$/i.test(parts[1]) && parts[2] === "rulings") return this.rulingsOf(await this.byId(parts[1]));
        if (parts.length === 3 && !["search", "named", "autocomplete", "random", "collection"].includes(parts[1])) return this.bySetNumber(parts[1], parts[2]);
        if (parts.length === 4 && parts[3] === "rulings") return this.rulingsOf(await this.bySetNumber(parts[1], parts[2]));
        if (parts.length === 4) return this.bySetNumber(parts[1], parts[2], parts[3]);
        return undefined;
    }

    // ---- catalogs ----
    catalog(name: string): Answer {
        const data = this.index.catalogs[name];
        if (!data) return NOT_FOUND();
        return { status: 200, body: JSON.stringify({ object: "catalog", uri: `${API}catalog/${name}`, total_values: data.length, data }) };
    }

    // ---- sets ----
    async allSets(): Promise<Answer> {
        return { status: 200, body: (await this.read("sets.json"))! };
    }

    async set(codeOrId: string): Promise<Answer> {
        const want = codeOrId.toLowerCase();
        const i = this.index.sets.findIndex(([code, id]) => code === want || id === want);
        if (i < 0) return error(404, "No Magic set found for the given code or ID");
        const set = JSON.parse((await this.read("sets.json"))!).data[i];
        // Scryfall's /sets list counts every printing in card_count, but one set on its own leaves out variations
        // (440 for Murders at Karlov Manor, against 451 in the list, 9 Oct 2026): its count is made here from the
        // bulk file, as Scryfall's own is
        set.card_count = this.index.setCounts[set.code] ?? 0;
        return { status: 200, body: JSON.stringify(set) };
    }

    // ---- cards ----
    // a card object as Scryfall gives it, by id
    async cardText(id: string): Promise<string | undefined> {
        const file = await this.read(`cards/${cardKey(id)}.jsonl`);
        if (!file) return undefined;
        const at = file.indexOf(`{"object":"card","id":"${id}"`);
        if (at < 0) return undefined;
        const end = file.indexOf("\n", at);
        return file.slice(at, end < 0 ? undefined : end);
    }

    async byId(id: string): Promise<Answer | undefined> {
        const text = await this.cardText(id.toLowerCase());
        if (text) return { status: 200, body: text };
        // a card in another language isn't here without all_cards: Scryfall may know it
        if (!this.index.languages) return undefined;
        return NOT_FOUND();
    }

    async bySetNumber(set: string, number: string, lang?: string): Promise<Answer | undefined> {
        const file = await this.read(`prints/${set.toLowerCase()}.json`);
        const prints: [string, string, string][] = file ? JSON.parse(file) : [];
        const here = prints.filter(([cn]) => cn === number);
        let hit: [string, string, string] | undefined;
        if (lang) hit = here.find(([, l]) => l === lang.toLowerCase());
        else hit = here.find(([, l]) => l === "en") ?? here[0];
        if (!hit) {
            if (lang && !this.index.languages && lang.toLowerCase() !== "en") return undefined;
            return NO_CARD();
        }
        return { status: 200, body: (await this.cardText(hit[2]))! };
    }

    // ---- rulings ----
    async rulingsOf(card: Answer | undefined): Promise<Answer | undefined> {
        // an unknown card is the message a missing set and number gets, even for an id
        if (card?.status === 404) return NO_CARD();
        if (!card || card.status !== 200) return card;
        const c = JSON.parse(card.body);
        const oracle: string | undefined = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
        const file = oracle ? await this.read(`rulings/${oracle.slice(0, 2)}.json`) : undefined;
        const list: { published_at: string }[] = (file && oracle ? JSON.parse(file)[oracle] : undefined) ?? [];
        // Scryfall lists the newest first. Rulings from the same day come in the order Scryfall added them, which
        // the bulk file doesn't keep (it has them oldest first, the same day's in another order), so those keep
        // the bulk file's order
        const data = [...list].sort((a, b) => a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0);
        return { status: 200, body: JSON.stringify({ object: "list", has_more: false, data }) };
    }

    // ---- names ----
    async named(params: URLSearchParams): Promise<Answer | undefined> {
        const exact = params.get("exact"), fuzzy = params.get("fuzzy"), set = params.get("set")?.toLowerCase();
        // the errors quote the name as asked, without spaces around it
        const asked = (exact ?? fuzzy)?.trim();
        if (asked == null) return undefined;
        const found = exact != null ? this.exactName(exact) : this.fuzzyName(fuzzy!);
        if (found === "ambiguous") return error(404, `Too many cards match ambiguous name “${asked}”. Add more words to refine your search.`, "ambiguous");
        if (!found) return error(404, `No cards found matching “${asked}”`);
        const id = set ? await this.printingIn(found, set) : this.index.shown[found.oracles[0]] ?? found.prints[0];
        if (!id) return error(404, `No cards found matching “${asked}”`);
        return { status: 200, body: (await this.cardText(id))! };
    }

    // exact: the whole name or a face's, as fold() compares them; not art series cards
    exactName(asked: string): NameEntry | undefined {
        const q = fold(asked);
        return best(this.folded.filter((f) => !f.e.art && (f.full === q || f.faces.includes(q))));
    }

    // fuzzy: an exact name first, else the one name with every word of the question in it
    fuzzyName(asked: string): NameEntry | "ambiguous" | undefined {
        const exact = this.exactName(asked);
        if (exact) return exact;
        const words = fold(asked).split(" ").filter(Boolean);
        if (!words.length) return undefined;
        const hits = this.folded.filter((f) => !f.e.art && words.every((w) => f.compact.includes(w)));
        if (hits.length > 1) return "ambiguous";
        return hits[0]?.e;
    }

    // the card's printing in a set: the lowest collector number when it has several (Scheming Fence in SNC is
    // 219, not the showcase 349)
    async printingIn(e: NameEntry, set: string): Promise<string | undefined> {
        const file = await this.read(`prints/${set}.json`);
        if (!file) return undefined;
        const ids = new Set(e.prints);
        const here = (JSON.parse(file) as [string, string, string][]).filter(([, , id]) => ids.has(id));
        here.sort(([a], [b]) => (parseInt(a) || 0) - (parseInt(b) || 0) || (a < b ? -1 : a > b ? 1 : 0));
        return here[0]?.[2];
    }

    // Up to 20 card names with the question in them, spaces, punctuation, accents and case ignored ("nebe" finds
    // Dune Beetle): cards a search shows (not tokens, art cards or playtest cards; all of those with
    // include_extras), the names that start with it first. Under two letters, none
    async autocomplete(params: URLSearchParams): Promise<Answer | undefined> {
        const q = fold(params.get("q") ?? "").replace(/ /g, "");
        const extras = params.get("include_extras") === "true";
        let data: string[] = [];
        if (q.length >= 2) {
            const pool = this.folded.filter((f) => (extras ? !f.e.art : f.e.card && f.e.visible) && f.compact.includes(q));
            const byLength = (a: Folded, b: Folded) => a.compact.length - b.compact.length;
            const starts = pool.filter((f) => f.compact.startsWith(q)).sort(byLength);
            const rest = pool.filter((f) => !f.compact.startsWith(q)).sort(byLength);
            data = [...starts, ...rest].slice(0, 20).map((f) => f.e.name);
        }
        return { status: 200, body: JSON.stringify({ object: "catalog", total_values: data.length, data }) };
    }
}
