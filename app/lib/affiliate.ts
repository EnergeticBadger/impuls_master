// ---- our own affiliate tags on the "Buy on" links ----

// The links in the card data are Scryfall's, carrying Scryfall's affiliate ids (the build compares printings
// against that shape, so it stays as it is). Before a link is shown it goes through buyLink, which takes
// Scryfall's tags off and puts ours on. An empty id means a plain link with no tracking: never Scryfall's.
// These ids aren't secrets; they show in every link.
export const AFFILIATE_IDS = {
    // the Impact path after partner.tcgplayer.com/c/, e.g. "1234567/1830156/21018"
    tcgplayer: "",
    // ?referrer= on cardmarket.com
    cardmarket: "",
    // ?affiliate_id= on cardhoarder.com
    cardhoarder: "",
    // ?partner= on cardkingdom.com
    cardkingdom: "",
};

export type Store = keyof typeof AFFILIATE_IDS;

// query parameters that only say who sent the visitor
const TRACKING = ["referrer", "affiliate_id", "partner", "ref", "utm_source", "utm_medium", "utm_campaign", "subId1"];

function untracked(url: URL): URL {
    for (const key of TRACKING) url.searchParams.delete(key);
    return url;
}

// the link with Scryfall's tags swapped for ours; links we can't read pass through unchanged
export function buyLink(store: Store, link: string, ids = AFFILIATE_IDS): string {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return link;
    }
    const id = ids[store];
    if (store === "tcgplayer") {
        // partner links are a redirect: the product page is in ?u=
        const target = url.hostname === "partner.tcgplayer.com" ? url.searchParams.get("u") : link;
        if (!target) return link;
        return id ? `https://partner.tcgplayer.com/c/${id}?u=${encodeURIComponent(target)}` : target;
    }
    untracked(url);
    if (id && store === "cardmarket") url.searchParams.set("referrer", id);
    if (id && store === "cardhoarder") url.searchParams.set("affiliate_id", id);
    if (id && store === "cardkingdom") url.searchParams.set("partner", id);
    return url.toString();
}

// a whole deck on TCGplayer's mass entry page: "count name" per card (front face), joined by "||"
export function tcgplayerDeckLink(lines: { count: number; name: string }[], ids = AFFILIATE_IDS): string {
    const url = new URL("https://www.tcgplayer.com/massentry");
    url.searchParams.set("productline", "Magic");
    url.searchParams.set("c", lines.map((l) => `${l.count} ${l.name.split(" // ")[0]}`).join("||"));
    return buyLink("tcgplayer", url.toString(), ids);
}

// Card Kingdom isn't in Scryfall's data, so its link is a search by the front face's name
export function cardKingdomLink(name: string, ids = AFFILIATE_IDS): string {
    const url = new URL("https://www.cardkingdom.com/catalog/search");
    url.searchParams.set("search", "header");
    url.searchParams.set("filter[name]", name.split(" // ")[0]);
    return buyLink("cardkingdom", url.toString(), ids);
}
