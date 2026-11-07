// The current deck bar's "In <commander>'s colors" toggle looks for identityTerm(...) in the query rebuilt from
// the search bar's chips. This checks the term survives parseQuery -> buildQuery for every color identity, and
// that toggling it twice gives the query back. Run: node --import ./scripts/app-paths.ts scripts/test-identity-chips.ts
import assert from "node:assert/strict";
import { buildQuery, parseQuery } from "../app/Components/Searchbar/filters.ts";
import { hasTerm, toggleTerm } from "../app/Components/Searchbar/queryTerms.ts";
import { COLORS, identityTerm } from "../app/lib/deck.ts";

const identities: string[][] = [[]];
for (const c of COLORS) for (const prev of [...identities]) identities.push([...prev, c]);

let checked = 0;
for (const colors of identities) {
    const term = identityTerm(colors);
    for (const base of ["", "t:elf"]) {
        const on = buildQuery(parseQuery(toggleTerm(base, term)) as Parameters<typeof buildQuery>[0]);
        assert.ok(hasTerm(on, term), `${JSON.stringify(term)} survives the chips: ${JSON.stringify(on)}`);
        assert.equal(toggleTerm(on, term), base, `toggling ${term} off gives ${JSON.stringify(base)} back`);
        checked++;
    }
}
console.log(`identity terms survive the chips: ${checked} checks passed`);
