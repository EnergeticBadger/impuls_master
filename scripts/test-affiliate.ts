// Checks that "Buy on" links never carry Scryfall's affiliate ids, with and without ours set:
// npm run test-affiliate. Offline; exit code 1 on any failure.

import assert from "node:assert/strict";
import { buyLink, cardKingdomLink, AFFILIATE_IDS } from "../app/lib/affiliate.ts";

const none = { tcgplayer: "", cardmarket: "", cardhoarder: "", cardkingdom: "" };
const ours = { tcgplayer: "111/222/333", cardmarket: "impulse", cardhoarder: "impulse", cardkingdom: "impulse" };

// the shapes Scryfall's data uses (see LINK_TEMPLATES in app/lib/carddata.ts)
const TCG = "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F12345%3Fpage%3D1";
const CM = "https://www.cardmarket.com/en/Magic/Products?idProduct=678&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall";
const CH = "https://www.cardhoarder.com/cards/910?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall";

let failed = 0;
function check(name: string, run: () => void) {
    try {
        run();
        console.log(`ok   ${name}`);
    } catch (e) {
        failed++;
        console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n").join("\n     ")}`);
    }
}

check("the ids shipped in the app aren't Scryfall's", () => {
    for (const id of Object.values(AFFILIATE_IDS)) assert.ok(!/scryfall|4931599/i.test(id), id);
});

for (const [label, ids] of [["no ids", none], ["our ids", ours]] as const) {
    for (const [store, link] of [["tcgplayer", TCG], ["cardmarket", CM], ["cardhoarder", CH]] as const) {
        check(`${store}, ${label}: no Scryfall tags`, () => {
            const out = buyLink(store, link, ids);
            assert.ok(!/scryfall|4931599/i.test(out), out);
        });
    }
}

check("tcgplayer, no ids: straight to the product page", () => {
    assert.equal(buyLink("tcgplayer", TCG, none), "https://www.tcgplayer.com/product/12345?page=1");
});
check("tcgplayer, our ids: our partner path, same product", () => {
    const out = new URL(buyLink("tcgplayer", TCG, ours));
    assert.equal(out.pathname, "/c/111/222/333");
    assert.equal(out.searchParams.get("u"), "https://www.tcgplayer.com/product/12345?page=1");
});
check("tcgplayer search links keep their search", () => {
    const search = "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fmagic%2Fproduct%3Fq%3DOpt";
    assert.equal(buyLink("tcgplayer", search, none), "https://www.tcgplayer.com/search/magic/product?q=Opt");
});
check("cardmarket keeps the product and sets our referrer", () => {
    const out = new URL(buyLink("cardmarket", CM, ours));
    assert.equal(out.searchParams.get("idProduct"), "678");
    assert.equal(out.searchParams.get("referrer"), "impulse");
});
check("cardhoarder keeps the card and sets our affiliate id", () => {
    const out = new URL(buyLink("cardhoarder", CH, ours));
    assert.equal(out.pathname, "/cards/910");
    assert.equal(out.searchParams.get("affiliate_id"), "impulse");
});
check("links that aren't URLs pass through", () => {
    assert.equal(buyLink("cardmarket", "not a url", ours), "not a url");
});
check("card kingdom searches the front face, with our partner id when set", () => {
    const plain = new URL(cardKingdomLink("Delver of Secrets // Insectile Aberration", none));
    assert.equal(plain.searchParams.get("filter[name]"), "Delver of Secrets");
    assert.equal(plain.searchParams.get("partner"), null);
    assert.equal(new URL(cardKingdomLink("Opt", ours)).searchParams.get("partner"), "impulse");
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
