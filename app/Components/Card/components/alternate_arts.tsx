import { proxy } from "valtio";
import type { Print } from "~/types";



export const alternate = proxy<Print>({
    name: 'none',
    uri: 'none'
})


export function setCurrentAlternate(name: string, uri: string) {
    alternate.name = name
    alternate.uri = uri
}



export const all_alt_art = proxy<{ name: string, prints: Print[] }>({ name: '', prints: [] })

export function setAltArtList(name: string, prints: Print[]) {
    all_alt_art.prints = prints
    all_alt_art.name = name
}