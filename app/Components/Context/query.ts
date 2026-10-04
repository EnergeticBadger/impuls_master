import { proxy } from "valtio";
import type { Chip } from "../Searchbar/filters";

// A search that came back empty, kept so the "no cards found" pop-up can explain it
export type NoResults = { query: string, status: number, details: string, warnings: string[] }

// The search being put together, one chip per filter.
// Shared so the "no cards found" pop-up can take a filter out and search again.
export const querybox = proxy<{ chips: Chip[], noResults: NoResults | null }>({ chips: [], noResults: null })

let nextId = 0
export const chipId = () => ++nextId
