import { proxy } from "valtio";
import { deepClone } from "valtio/utils";
import type { CardProps } from "~/types";



export const cardsearch = proxy<{ list: CardProps[] }>({ list: [] })


export function setCards(newCards:CardProps[]) {
    cardsearch.list = deepClone(newCards)
}