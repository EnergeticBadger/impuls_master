// Card data from Scryfall's daily bulk files, packed into files that ship with the site
// (scripts/card-data.ts writes them), so card pages and the quick view don't need the API.
// Shared by that script and the app, so both agree on where each card lives. No runtime imports here:
// the script runs this file directly with Node.
//
// One record per card (every printing of a spell shares one page), holding everything its page needs:
// the rules text, rulings and a compact entry per printing. Records are packed into bucket files by the
// card's name; each file starts with a one-line header saying where each record sits, so a page reads
// the file but only parses its own record. That keeps a page well inside the free plan's 10ms of CPU.
import type { ImageUris, Prices, Ruling, ScryfallCard } from "~/types";

export const SITE_URL = "https://impulsecaster.cards";

// under the site root: /data/...
export const DATA_DIR = "data";

// about 40 cards per file
export const BUCKETS = 1024;

// "Lightning Bolt" -> "lightning-bolt", so links read nicely and search engines see the name in the URL
export function slug(name: string) {
    return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// which file a card is in, by its name's slug (FNV-1a hash, so it doesn't depend on order)
export function bucketOf(nameSlug: string) {
    let h = 0x811c9dc5;
    for (let i = 0; i < nameSlug.length; i++) {
        h ^= nameSlug.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) % BUCKETS;
}

export const paths = {
    bucket: (bucket: number) => `${DATA_DIR}/cards/${bucket}.json`,
    // page slug -> name slug, for the few cards whose page needed more than the name (see Renamed)
    renamed: () => `${DATA_DIR}/cards/renamed.json`,
};

// Cards that share a name with another card (tokens called "Soldier", the Unstable variants) get a longer
// slug: "soldier-token", "everythingamajig-2". Maps each such slug to the name slug its file is found by.
export type Renamed = Record<string, string>;

// reversible cards keep the oracle id on their faces
export const oracleOf = (card: Pick<ScryfallCard, "oracle_id" | "card_faces">) =>
    card.oracle_id ?? (card.card_faces?.[0] as { oracle_id?: string } | undefined)?.oracle_id;

// one printing, as small as it can be: its links are rebuilt from its ids (see printingCard)
export type Printing = {
    id: string;
    set: string;
    set_name: string;
    number: string;
    rarity: string;
    released: string;
    // only when the printing isn't in English (Scryfall lists English when it has it)
    lang?: string;
    artist?: string;
    flavor?: string;
    // artist and flavor text per face, for cards with faces
    faces?: { artist?: string; flavor?: string }[];
    // the image's version stamp; no stamp means no image
    img?: string;
    // the back face has its own image (double-faced cards)
    back?: 1;
    prices?: Partial<Prices>;
    // store and Gatherer ids the links are built from
    tcg?: number;
    mtgo?: number;
    cm?: number;
    mv?: number;
    // no store sells it (digital-only and the like)
    nobuy?: 1;
    // a link that isn't the usual one for its id ("" means the printing has no such link)
    links?: Partial<Record<LinkKey, string>>;
};

export type CardFaceText = {
    name: string;
    oracle_id?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    defense?: string;
};

export type CardRecord = {
    oracle_id: string;
    name: string;
    // this card's page: /card/<slug>
    slug: string;
    layout: string;
    mana_cost?: string;
    cmc: number;
    type_line: string;
    oracle_text?: string;
    colors?: string[];
    color_identity: string[];
    keywords: string[];
    legalities: Record<string, string>;
    reserved?: true;
    power?: string;
    toughness?: string;
    loyalty?: string;
    defense?: string;
    edhrec_rank?: number;
    edhrec?: string;
    faces?: CardFaceText[];
    rulings: Ruling[];
    // newest first
    prints: Printing[];
    // the printing the page opens on: the newest regular one
    main: number;
};

// header entry: [page slug, oracle id, byte offset, byte length], offsets counted from just after the header line
export type BucketEntry = [string, string, number, number];

const decoder = new TextDecoder();

// the header of a bucket file and where its records start
export function bucketHeader(bytes: Uint8Array): { entries: BucketEntry[]; body: number } {
    const newline = bytes.indexOf(10);
    return { entries: JSON.parse(decoder.decode(bytes.subarray(0, newline))), body: newline + 1 };
}

// parses one record out of a bucket file, leaving the rest of the file alone
export function readRecord(bytes: Uint8Array, header: { body: number }, entry: BucketEntry): CardRecord {
    const start = header.body + entry[2];
    return JSON.parse(decoder.decode(bytes.subarray(start, start + entry[3])));
}

// ---- links rebuilt from ids, so each printing doesn't carry several long URLs ----

export type LinkKey = "tcgplayer" | "cardmarket" | "cardhoarder" | "gatherer";

// the usual link for each id, or a search by name when the printing has no id; the build checks every
// printing against these and stores the exceptions
const form = (name: string) => new URLSearchParams({ q: name }).toString().slice(2);
type LinkTemplate = { id: "tcg" | "cm" | "mtgo" | "mv"; url: (id: number) => string; search?: (name: string) => string };
export const LINK_TEMPLATES: Record<LinkKey, LinkTemplate> = {
    tcgplayer: {
        id: "tcg",
        url: (id) => `https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F${id}%3Fpage%3D1`,
        search: (name) => `https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fmagic%2Fproduct%3FproductLineName%3Dmagic%26q%3D${encodeURIComponent(form(name))}%26view%3Dgrid`,
    },
    cardmarket: {
        id: "cm",
        url: (id) => `https://www.cardmarket.com/en/Magic/Products?idProduct=${id}&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall`,
        search: (name) => `https://www.cardmarket.com/en/Magic/Products/Search?referrer=scryfall&searchString=${form(name)}&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall`,
    },
    cardhoarder: {
        id: "mtgo",
        url: (id) => `https://www.cardhoarder.com/cards/${id}?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall`,
        search: (name) => `https://www.cardhoarder.com/cards?affiliate_id=scryfall&data%5Bsearch%5D=${form(name)}&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall`,
    },
    gatherer: { id: "mv", url: (id) => `https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=${id}&printed=false` },
};

// the link as the templates would make it
export function templateLink(p: Printing, key: LinkKey, name: string): string | undefined {
    const t = LINK_TEMPLATES[key];
    if (p.nobuy && t.search) return undefined;
    const id = p[t.id];
    // stores search double-faced cards by the front's name
    return id ? t.url(id) : t.search?.(name.split(" // ")[0]);
}

export function printingLink(p: Printing, key: LinkKey, name: string): string | undefined {
    const own = p.links?.[key];
    if (own !== undefined) return own || undefined;
    return templateLink(p, key, name);
}

const IMAGE_HOST = "https://cards.scryfall.io";

export function imageUris(id: string, side: "front" | "back", stamp: string): ImageUris {
    const at = (size: string) => `${IMAGE_HOST}/${size}/${side}/${id[0]}/${id[1]}/${id}.jpg?${stamp}`;
    return {
        small: at("small"), normal: at("normal"), large: at("large"),
        png: `${IMAGE_HOST}/png/${side}/${id[0]}/${id[1]}/${id}.png?${stamp}`,
        art_crop: at("art_crop"), border_crop: at("border_crop"),
    };
}

export const smallImage = (p: Printing) => (p.img ? imageUris(p.id, "front", p.img).small : undefined);

// a printing by "<set>-<collector number>", the ?print= value on a card's page
export const printKey = (p: { set: string; number: string }) => `${p.set}-${p.number}`;
export function findPrinting(record: Pick<CardRecord, "prints">, key: string) {
    const k = key.toLowerCase();
    return record.prints.findIndex((p) => printKey(p).toLowerCase() === k);
}

// the card as the app's components expect it (Scryfall's shape), for one of its printings
export function printingCard(record: CardRecord, p: Printing): ScryfallCard {
    const api = `https://api.scryfall.com/cards/${p.id}`;
    const faceImages = p.img && p.back;
    const links = (keys: LinkKey[]) =>
        Object.fromEntries(keys.map((k) => [k, printingLink(p, k, record.name)]).filter(([, v]) => v));
    const card = {
        object: "card",
        id: p.id,
        oracle_id: record.oracle_id,
        name: record.name,
        lang: p.lang ?? "en",
        released_at: p.released,
        uri: api,
        scryfall_uri: `https://scryfall.com/card/${p.set}/${encodeURIComponent(p.number)}`,
        rulings_uri: `${api}/rulings`,
        prints_search_uri: `https://api.scryfall.com/cards/search?order=released&q=oracleid%3A${record.oracle_id}&unique=prints`,
        layout: record.layout,
        image_uris: p.img && !faceImages ? imageUris(p.id, "front", p.img) : undefined,
        mana_cost: record.mana_cost ?? "",
        cmc: record.cmc,
        type_line: record.type_line,
        oracle_text: record.oracle_text ?? "",
        flavor_text: p.flavor,
        power: record.power,
        toughness: record.toughness,
        loyalty: record.loyalty,
        defense: record.defense,
        colors: record.colors ?? [],
        color_identity: record.color_identity,
        keywords: record.keywords,
        legalities: record.legalities,
        reserved: !!record.reserved,
        set: p.set,
        set_name: p.set_name,
        collector_number: p.number,
        rarity: p.rarity,
        artist: p.artist ?? p.faces?.find((f) => f.artist)?.artist ?? "",
        edhrec_rank: record.edhrec_rank,
        prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null, ...p.prices },
        purchase_uris: links(["tcgplayer", "cardmarket", "cardhoarder"]),
        related_uris: { ...links(["gatherer"]), ...(record.edhrec ? { edhrec: record.edhrec } : {}) },
        card_faces: record.faces?.map((f, i) => ({
            ...f,
            artist: p.faces?.[i]?.artist,
            flavor_text: p.faces?.[i]?.flavor,
            image_uris: faceImages && i < 2 ? imageUris(p.id, i === 0 ? "front" : "back", p.img!) : undefined,
        })),
    };
    return card as unknown as ScryfallCard;
}

// ---- the list of printings on a card's page ----

export type PrintEntry = {
    key: string;
    set: string;
    set_name: string;
    number: string;
    small?: string;
    usd: string | null;
};

export const printEntry = (p: Printing): PrintEntry => ({
    key: printKey(p),
    set: p.set,
    set_name: p.set_name,
    number: p.number,
    small: smallImage(p),
    usd: p.prices?.usd ?? p.prices?.usd_foil ?? p.prices?.usd_etched ?? null,
});

// the cheapest and dearest US price across every printing, for search engines
export function priceRange(record: CardRecord): { low: string; high: string } | null {
    let low = Infinity, high = -Infinity;
    for (const p of record.prints) {
        for (const v of [p.prices?.usd, p.prices?.usd_foil, p.prices?.usd_etched]) {
            const n = v ? Number(v) : NaN;
            if (Number.isFinite(n)) { low = Math.min(low, n); high = Math.max(high, n); }
        }
    }
    return Number.isFinite(low) ? { low: low.toFixed(2), high: high.toFixed(2) } : null;
}
