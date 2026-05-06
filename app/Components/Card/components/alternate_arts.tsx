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



export const all_alt_art = proxy<{prints:Print[]}>({prints:[]})

export function setAltArtList(prints:Print[]) {
    all_alt_art.prints = prints 
}