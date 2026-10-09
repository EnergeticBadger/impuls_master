// The printings in other languages, for the local search's lang:, in:ja and new:language: npm run languages
// default_cards has each printing once, in English or the one language it came out in; Scryfall's lang:ja, -lang:en
// and lang:any search the rest too. They're in all_cards (395 MB compressed), far too big to load with everything
// else, so this keeps what a search needs of the printings default_cards doesn't have, in languages.jsonl.gz
// (about 30 MB) beside default_cards, where scripts/local-search.ts finds it. Also fetches art_tags (atag:) there.
// The bulk files are SCRYFALL_BULK_DIR's when it's set (all_cards.jsonl.gz must be there), otherwise downloaded
// into fuzz-results/bulk; --out <dir> writes elsewhere.

import { createWriteStream, existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip, createGzip } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { bulkFile } from "./local-search.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const cache = resolve("fuzz-results", "bulk");
const defaults = await bulkFile("default_cards", cache);
const out = at >= 0 && args[at + 1] ? resolve(args[at + 1]) : dirname(defaults);
await bulkFile("art_tags", cache);
const all = await bulkFile("all_cards", cache);
if (!existsSync(all)) throw new Error(`no ${all}: put all_cards.jsonl.gz there, or unset SCRYFALL_BULK_DIR to download it`);

const lines = (path: string) => createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });

// default_cards' printings, which the search has already
const known = new Set<string>();
for await (const line of lines(defaults)) if (line.trim()) known.add(JSON.parse(line).id);

// what local-search.ts's toPrinting and extraKind read of a printing (legalities are the card's, so they're left
// out), and a face's
const KEEP = ["id", "oracle_id", "name", "printed_name", "flavor_name", "layout", "lang", "set", "set_type", "block_code", "rarity", "artist",
    "artist_ids", "released_at", "frame", "frame_effects", "border_color", "games", "collector_number", "promo", "promo_types", "digital",
    "full_art", "textless", "reprint", "story_spotlight", "oversized", "booster", "highres_image", "finishes", "watermark", "flavor_text",
    "security_stamp", "illustration_id", "type_line"];
const FACE = ["name", "printed_name", "flavor_name", "watermark", "flavor_text", "illustration_id", "type_line", "oracle_id"];
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));

const SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");
const gzip = createGzip();
const file = createWriteStream(join(out, "languages.jsonl.gz"));
gzip.pipe(file);
let kept = 0;
for await (const line of lines(all)) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (known.has(c.id)) continue;
    const p: any = pick(c, KEEP);
    const prices = pick(c.prices ?? {}, ["usd", "usd_foil", "usd_etched", "eur", "eur_foil", "tix"]);
    if (Object.keys(prices).length) p.prices = prices;
    if (c.preview?.source) p.preview = { source: c.preview.source };
    if (c.card_faces?.length) p.card_faces = c.card_faces.map((f: any) => pick(f, FACE));
    // a line each, so the line and paragraph separators some flavor text has are escaped: Node's readline would
    // break a line at them
    const json = JSON.stringify(p).replace(SEPARATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
    if (!gzip.write(json + "\n")) await new Promise((res) => gzip.once("drain", res));
    kept++;
}
gzip.end();
await new Promise((res) => file.on("finish", res));
console.log(`${kept.toLocaleString()} printings in other languages: ${join(out, "languages.jsonl.gz")}`);
