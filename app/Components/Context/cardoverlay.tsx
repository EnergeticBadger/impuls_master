import { proxy } from "valtio";



export const cardoverlay = proxy<{card:string}>({
    card:'none'
})


export function setCardOverlay (name:string) {
    cardoverlay.card = name
}