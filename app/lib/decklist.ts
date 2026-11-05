// ---- deck lists as plain text: read what other sites export, write what they accept. Pure, no UI ----

import type { ScryfallCard } from "~/types";
import { addCard, emptyDeck, type Deck, type DeckEntry } from "./deck.ts";

export type Line = { count: number; name: string; set?: string; number?: string }
export type DeckListStyle = "text" | "arena" | "mtgo"

export type Zone = "main" | "side" | "commander"
type ParseZone = Zone | "companion"

// "4 Opt", "4x Opt", "4 Opt (XLN) 65"; an "SB:" prefix (MTGO) is dealt with before this
const LINE = /^(\d+)\s*[xX]?\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+))?)?$/;

const HEADERS: Record<string, ParseZone> = {
    deck: "main", maindeck: "main", main: "main",
    sideboard: "side", side: "side", companion: "companion",
    commander: "commander",
};

export function parseDeckList(text: string): { main: Line[]; side: Line[]; commander?: Line; problems: string[] } {
    const main: Line[] = [];
    const side: Line[] = [];
    let commander: Line | undefined;
    const companions: Line[] = [];
    const problems: string[] = [];
    let zone: ParseZone = "main";

    text.split(/\r?\n/).forEach((raw, i) => {
        let line = raw.trim();
        if (line === "") {
            // a blank line ends the commander section, and (MTGO) splits the sideboard off the main deck
            if (zone === "commander") zone = "main";
            else if (zone === "main" && main.length > 0) zone = "side";
            return;
        }
        const header = HEADERS[line.replace(/:$/, "").toLowerCase()];
        if (header) {
            zone = header;
            return;
        }
        // Arena exports can start with "About" and "Name ..." lines
        if (/^about$/i.test(line) || /^name\s/i.test(line)) return;

        let target = zone;
        const sb = /^SB:\s*(.*)$/i.exec(line);
        if (sb) {
            line = sb[1];
            target = "side";
        }
        const m = LINE.exec(line);
        const count = m ? Number(m[1]) : 0;
        if (!m || count < 1) {
            problems.push(`Line ${i + 1}: can't read "${raw.trim()}".`);
            return;
        }
        const entry: Line = { count, name: m[2] };
        if (m[3]) entry.set = m[3].toLowerCase();
        if (m[4]) entry.number = m[4];

        if (target === "commander") {
            if (commander) problems.push(`Line ${i + 1}: there is already a commander, "${raw.trim()}" is extra.`);
            else commander = entry;
        } else if (target === "companion") {
            companions.push(entry);
        } else {
            (target === "side" ? side : main).push(entry);
        }
    });

    // Arena lists the companion again in the sideboard: only add it when the sideboard doesn't have it
    for (const c of companions) {
        if (!side.some(s => s.name.toLowerCase() === c.name.toLowerCase())) side.push(c);
    }

    return commander ? { main, side, commander, problems } : { main, side, problems };
}

// one typed line ("4 Opt", "Opt", "1 Opt (M19) 65") as a Line; no count means 1
export function quickAddLine(text: string): Line | undefined {
    const trimmed = text.trim();
    if (trimmed === "") return undefined;
    const first = parseDeckList(trimmed).main[0];
    if (first) return first;
    return parseDeckList(`1 ${trimmed}`).main[0];
}

export type FoundLine ={ line: { count: number; zone: Zone }; card: ScryfallCard }

// a deck from looked-up lines; the same card on two lines of a zone adds the counts
export function deckFromLines(found: FoundLine[]): Deck {
    let deck = emptyDeck();
    for (const { line, card } of found) {
        if (line.zone === "commander") deck = { ...deck, commander: { card, count: line.count } };
        else deck = addCard(deck, card, line.zone, line.count);
    }
    return deck;
}

function write(entry: DeckEntry, style: DeckListStyle): string {
    const card = entry.card;
    // Arena and MTGO list double-faced cards by their front face; split cards keep the full name
    // reversible cards ("Propaganda // Propaganda") are known by their one face name everywhere, text included
    const frontOnly = card.layout === "reversible_card"
        || (style !== "text" && ["transform", "modal_dfc", "adventure", "flip"].includes(card.layout));
    const name = frontOnly && card.card_faces?.[0]?.name ? card.card_faces[0].name : card.name;
    if (style === "arena" && entry.card.set && entry.card.collector_number) {
        return `${entry.count} ${name} (${entry.card.set.toUpperCase()}) ${entry.card.collector_number}`;
    }
    return `${entry.count} ${name}`;
}

export function formatDeckList(deck: Deck, style: DeckListStyle): string {
    const blocks: string[][] = [];
    const lines = (entries: DeckEntry[]) => entries.map(e => write(e, style));

    if (style === "mtgo" && deck.main.length > 0) {
        // MTGO has no section headers: a blank line starts the sideboard, and the commander lives there
        const sideLines = lines([...(deck.commander ? [deck.commander] : []), ...deck.side]);
        const out = [lines(deck.main).join("\n"), ...(sideLines.length > 0 ? [sideLines.join("\n")] : [])];
        return out.join("\n\n") + "\n";
    }

    if (deck.commander) blocks.push(["Commander", ...lines([deck.commander])]);
    if (deck.main.length > 0 || (style === "arena" && deck.commander)) {
        // Arena names the main deck when something else comes before it; MTGO and plain text don't
        const head = style === "arena" || (deck.commander && deck.main.length > 0) ? ["Deck"] : [];
        blocks.push([...head, ...lines(deck.main)]);
    }
    if (deck.side.length > 0) {
        // MTGO separates the sideboard with just a blank line, unless there is no main deck to separate it from
        const head = style === "mtgo" && deck.main.length > 0 ? [] : ["Sideboard"];
        blocks.push([...head, ...lines(deck.side)]);
    }
    return blocks.map(b => b.join("\n")).join("\n\n") + (blocks.length > 0 ? "\n" : "");
}

// ---- deck links: the deck rides in the URL hash, so it never reaches our Worker ----

function toBase64Url(text: string): string {
    let binary = "";
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

export function deckLinkHash(name: string, deck: Deck): string {
    return `#deck=${toBase64Url(JSON.stringify({ n: name, l: formatDeckList(deck, "text") }))}`;
}

export function readDeckLinkHash(hash: string): { name: string; text: string } | undefined {
    const m = /^#?deck=([A-Za-z0-9_-]+)$/.exec(hash);
    if (!m) return undefined;
    try {
        const data: unknown = JSON.parse(fromBase64Url(m[1]));
        if (typeof data !== "object" || data === null) return undefined;
        const { n, l } = data as { n?: unknown; l?: unknown };
        if (typeof n !== "string" || typeof l !== "string") return undefined;
        return { name: n, text: l };
    } catch {
        return undefined;
    }
}
