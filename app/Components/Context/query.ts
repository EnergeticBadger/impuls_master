import { proxy } from "valtio";
import type { Chip } from "../Searchbar/filters";

// A search that came back empty or failed, kept so the pop-up can explain it.
// `message` is set when the search failed (Scryfall busy, no connection) rather than found nothing.
export type NoResults = { query: string, status: number, details: string, warnings: string[], message?: string }

// The search being put together, one chip per filter.
// Shared so the "no cards found" pop-up can take a filter out and search again.
export const querybox = proxy<{ chips: Chip[], noResults: NoResults | null }>({ chips: [], noResults: null })

let nextId = 0
export const chipId = () => ++nextId
