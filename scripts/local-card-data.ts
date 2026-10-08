// Puts card data into the local stand-in R2 bucket that `npm run bs` / `wrangler dev` read, so it can be tried
// locally: node scripts/local-card-data.ts [dir]   (default card-data)
// Whatever is in the folder goes in, so `npm run mechanics` alone is enough for the Keyword filter's mechanic
// counts, and a full `npm run card-data` gives the card and set pages too. Pages ask Scryfall for anything
// that isn't there. It's stored as version "local", the way scripts/upload-card-data.sh fills the real bucket.
// A dev server already running sees it within a minute (app/lib/carddata.server.ts checks the version once a
// minute). Delete .wrangler/state to go back to an empty bucket.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";

const dir = resolve(process.argv[2] ?? "card-data");
const VERSION = "local";

function files(d: string): string[] {
    return readdirSync(d).flatMap((name) => {
        const path = join(d, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

let all: string[] = [];
try {
    all = files(dir);
} catch { }
if (!all.length) {
    console.error(`No card data in ${dir}: run npm run mechanics (or npm run card-data) first`);
    process.exit(1);
}

const { env, dispose } = await getPlatformProxy<{ CARD_DATA: R2Bucket }>();
try {
    let done = 0;
    for (const path of all) {
        await env.CARD_DATA.put(`v/${VERSION}/${relative(dir, path)}`, readFileSync(path));
        if (++done % 200 === 0) console.log(`${done} of ${all.length} files`);
    }
    // only once every file is there, like the real upload
    await env.CARD_DATA.put("current", VERSION);
    console.log(`Put ${all.length} ${all.length === 1 ? "file" : "files"} from ${dir} in the local bucket. A running dev server sees them within a minute.`);
} finally {
    await dispose();
}
