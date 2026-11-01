import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketOf, bucketOfName, findEntryByName, pickPrinting, slug, type BucketEntry, type CardRecord, type Printing } from "./carddata.ts";

const print = (set: string, number: string): Printing =>
    ({ id: `${set}-${number}`, set, set_name: set, number, rarity: "common", released: "2020-01-01" });

const record = {
    name: "Opt",
    prints: [print("xln", "65"), print("dom", "60"), print("dom", "61"), print("m21", "7")],
    main: 3,
} as unknown as CardRecord;

test("pickPrinting matches set and number", () => {
    assert.equal(pickPrinting(record, "dom", "61").number, "61");
    assert.equal(pickPrinting(record, "DOM", "61").number, "61");
});

test("pickPrinting falls back to the set's first printing", () => {
    assert.equal(pickPrinting(record, "dom").number, "60");
    assert.equal(pickPrinting(record, "dom", "999").number, "60");
});

test("pickPrinting falls back to the page's own printing", () => {
    assert.equal(pickPrinting(record).set, "m21");
    assert.equal(pickPrinting(record, "zzz", "1").set, "m21");
});

test("names match without case or accents", () => {
    assert.equal(slug("LIM-DÛL's Vault"), slug("lim-dul's vault"));
});

const entries: BucketEntry[] = [
    ["fire-ice", "o1", 0, 10],
    ["bonecrusher-giant-stomp", "o2", 10, 10],
    ["opt", "o3", 20, 10],
    ["soldier-token", "o4", 30, 10],
];

test("findEntryByName finds split and double-faced cards by full name", () => {
    assert.equal(findEntryByName(entries, "Fire // Ice")?.[0], "fire-ice");
    assert.equal(findEntryByName(entries, "fire // ice")?.[0], "fire-ice");
    assert.equal(findEntryByName(entries, "Bonecrusher Giant // Stomp")?.[0], "bonecrusher-giant-stomp");
    assert.equal(findEntryByName(entries, "BONECRUSHER GIANT // STOMP")?.[0], "bonecrusher-giant-stomp");
    assert.equal(findEntryByName(entries, "Opt")?.[0], "opt");
});

test("findEntryByName finds nothing for a front face alone, so the caller falls back", () => {
    assert.equal(findEntryByName(entries, "Bonecrusher Giant"), undefined);
});

test("a full name's bucket is its slug's bucket", () => {
    assert.equal(bucketOfName("Fire // Ice"), bucketOf("fire-ice"));
});
