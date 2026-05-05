
export function isString(item: any): item is string {
    return (item && typeof item === 'string')
}

export function hasStatus(item: unknown): item is { status: string, details: string } {
    return (
        typeof item === 'object' &&
        item !== null &&
        'status' in item &&
        'details' in item
    )
}


export function hasData(item: unknown): item is ScryfallCardSearchResponse {
    return (
        typeof item === 'object' &&
        item !== null &&
        'data' in item &&
        'has_more' in item &&
        Array.isArray((item as any).data)
    );
}


export function isScryfallCard(item: any): item is ScryfallCard {
    return item?.object === 'card' && typeof item?.id === 'string';
}

export type CardProps = {
    name: string
    image_uri: string
    card_uri: string
    card: ScryfallCard
}

export type ScryfallCardSearchResponse = {
    object: string
    total_cards?: number
    has_more: boolean
    next_page?: string
    data: ScryfallCard[]
}

export type ScryfallCard = {
    object: string;
    id: string;
    oracle_id: string;
    multiverse_ids: number[];
    mtgo_id?: number;
    mtgo_foil_id?: number;
    tcgplayer_id?: number;
    cardmarket_id?: number;
    name: string;
    lang: string;
    released_at: string;
    uri: string;
    scryfall_uri: string;
    layout: string;
    highres_image: boolean;
    image_status: string;
    image_uris?: ImageUris;
    mana_cost: string;
    cmc: number;
    type_line: string;
    oracle_text: string;
    power?: string;
    toughness?: string;
    colors: string[];
    color_identity: string[];
    keywords: string[];
    legalities: Legalities;
    games: string[];
    reserved: boolean;
    foil: boolean;
    nonfoil: boolean;
    finishes: string[];
    oversized: boolean;
    promo: boolean;
    reprint: boolean;
    variation: boolean;
    set_id: string;
    set: string;
    set_name: string;
    set_type: string;
    set_uri: string;
    set_search_uri: string;
    scryfall_set_uri: string;
    rulings_uri: string;
    prints_search_uri: string;
    collector_number: string;
    digital: boolean;
    rarity: string;
    card_back_id: string;
    artist: string;
    artist_ids: string[];
    illustration_id: string;
    border_color: string;
    frame: string;
    full_art: boolean;
    textless: boolean;
    booster: boolean;
    story_spotlight: boolean;
    edhrec_rank?: number;
    penny_rank?: number;
    prices: Prices;
    related_uris: RelatedUris;
    purchase_uris: PurchaseUris;
}

export type ImageUris = {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
}

export type Legalities = {
    [key: string]: string; // Maps format name to legality status
}

export type Prices = {
    usd: string | null;
    usd_foil: string | null;
    usd_etched: string | null;
    eur: string | null;
    eur_foil: string | null;
    tix: string | null;
}

export type RelatedUris = {
    gatherer?: string;
    tcgplayer_infinite_articles?: string;
    tcgplayer_infinite_decks?: string;
    edhrec?: string;
}

export type PurchaseUris = {
    tcgplayer?: string;
    cardmarket?: string;
    cardhoarder?: string;
}