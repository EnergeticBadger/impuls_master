// ---- deck lists as plain text: read what other sites export, write what they accept. Pure, no UI ----

import type { Deck, DeckEntry } from "./deck.ts";

export type Line = { count: number; name: string; set?: string; number?: string }
export type DeckListStyle = "text" | "arena" | "mtgo"

type Zone = "main" | "side" | "commander" | "companion"

// "4 Opt", "4x Opt", "4 Opt (XLN) 65"; an "SB:" prefix (MTGO) is dealt with before this
const LINE = /^(\d+)\s*[xX]?\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+))?)?$/;

const HEADERS: Record<string, Zone> = {
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
    let zone: Zone = "main";

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

function write(entry: DeckEntry, style: DeckListStyle): string {
    const card = entry.card;
    // Arena and MTGO list double-faced cards by their front face; split cards keep the full name
    const frontOnly = style !== "text" && ["transform", "modal_dfc", "adventure", "flip"].includes(card.layout);
    const name = frontOnly && card.card_faces?.[0]?.name ? card.card_faces[0].name : card.name;
    if (style === "arena" && entry.card.set && entry.card.collector_number) {
        return `${entry.count} ${name} (${entry.card.set.toUpperCase()}) ${entry.card.collector_number}`;
    }
    return `${entry.count} ${name}`;
}

export function formatDeckList(deck: Deck, style: DeckListStyle): string {
    const blocks: string[][] = [];
    const lines = (entries: DeckEntry[]) => entries.map(e => write(e, style));

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
