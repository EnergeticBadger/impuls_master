import { proxy } from "valtio";
import type { Chip } from "../Searchbar/filters";

// A search that came back empty, kept so the "no cards found" pop-up can explain it
export type NoResults = { query: string, status: number, details: string, warnings: string[] }

// What's in the search box: finished filters as chips, plus whatever is still being typed.
// Shared so the "no cards found" pop-up can take a filter out and search again.
export const querybox = proxy<{ chips: Chip[], text: string, noResults: NoResults | null }>({ chips: [], text: '', noResults: null })

let nextId = 0
export const chipId = () => ++nextId
