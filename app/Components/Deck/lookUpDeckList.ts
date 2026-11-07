import { cardsByName } from "~/lib/card";
import type { Deck } from "~/lib/deck";
import { deckFromLines, parseDeckList, unchangedEntries, type FoundLine, type ZoneLine } from "~/lib/decklist";

// a deck from list text: one lookup per line, and notes for lines that can't be read or found.
// With `known` (the deck the text was made from), lines for cards it already has are not looked up again.
export async function lookUpDeckList(
  text: string,
  onProgress?: (done: number, total: number) => void,
  known?: Deck,
): Promise<{ deck: Deck; notes: string[] }> {
  let reused: FoundLine[] = []
  let lines: ZoneLine[]
  let problems: string[]
  if (known) {
    ({ reused, lookups: lines, problems } = unchangedEntries(known, text))
  } else {
    const parsed = parseDeckList(text)
    problems = parsed.problems
    lines = [
      ...(parsed.commander ? [{ ...parsed.commander, zone: "commander" as const }] : []),
      ...parsed.main.map((l) => ({ ...l, zone: "main" as const })),
      ...parsed.side.map((l) => ({ ...l, zone: "side" as const })),
    ]
  }
  onProgress?.(0, lines.length)
  const { found, missing } = await cardsByName(lines, onProgress)
  const deck = deckFromLines([...reused, ...found])
  const notes = [...problems, ...missing.map((l) => `Card not found: ${l.count} ${l.name}`)]
  return { deck, notes }
}
