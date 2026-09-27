import { hasData, hasStatus, isScryfallCard, type CardProps, type ImageUris, type ScryfallCard } from '~/types'
import styles from './Searchbar.module.css'
import { useState, type SubmitEvent } from 'react' // Use FormEvent for form submissions
import { useSnapshot } from 'valtio';
import { cardsearch, getPage, pageKey, showPage } from '../Context/cards';
import { scryfallGet } from '~/lib/scryfall';
import { setCurrentAlternate } from '../Card/components/alternate_arts';


async function searchCard(page: number, query: string) {
    const params = new URLSearchParams({
        page: String(page),
        q: query,
        include_extras: "false",
        include_multilingual: "false",
        include_variations: "false",
        order: "name",
        unique: "cards",
    })
    return scryfallGet(`cards/search?${params}`)
}

type PageData = { cards: CardProps[], has_more: boolean, total_pages: number }

// Scryfall returns up to 175 cards per search page
const PAGE_SIZE = 175

// page data by query+page, shared by real searches and prefetches so Next reuses an in-flight prefetch
const pageData = new Map<string, Promise<PageData>>()
const MAX_PAGE_DATA = 20

function loadPage(query: string, page: number): Promise<PageData> {
    const key = pageKey(query, page)
    let data = pageData.get(key)
    if (!data) {
        data = searchCard(page, query).then((res) => {
            // see if there were any errors
            if (hasStatus(res) || !hasData(res)) throw new Error(`${res.status}`, { cause: res.details });

            const validCards = res.data.filter(isScryfallCard);
            if (validCards.length === 0) throw new Error('200', { cause: 'No Cards Found' });

            const cards: CardProps[] = validCards
                .map(c => { return { name: c.name, image_uri: c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal, card_uri: c.uri, card:c } }).filter((card): card is CardProps => !!card?.image_uri);
            const total_pages = Math.max(1, Math.ceil((res.total_cards ?? 0) / PAGE_SIZE))
            return { cards, has_more: !!res.has_more, total_pages }
        })
        // don't keep failures around, so the next try fetches again
        data.catch(() => pageData.delete(key))
        pageData.set(key, data)
        if (pageData.size > MAX_PAGE_DATA) pageData.delete(pageData.keys().next().value!)
    }
    return data
}

// wait for the images on screen to finish (or 5s) so preloading never slows the page being viewed
function afterVisibleImages() {
    const pending = [...document.images].filter((img) => !img.complete)
    return Promise.race([
        Promise.all(pending.map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }) }))),
        new Promise((r) => setTimeout(r, 5000)),
    ])
}

// images being preloaded for the next page; dropped when a newer preload starts
let warming: HTMLImageElement[] = []
let preloadRun = 0

// fetch the next page's data and pull its images into the browser cache, so Next shows it instantly
async function preloadNext(query: string, page: number, has_more: boolean) {
    const run = ++preloadRun
    for (const img of warming) img.removeAttribute('src')
    warming = []
    if (!has_more || getPage(pageKey(query, page + 1))) return

    try {
        const next = await loadPage(query, page + 1)
        await afterVisibleImages()
        if (run !== preloadRun) return
        warming = next.cards.map((c) => {
            const img = new Image()
            img.decoding = 'async'
            img.src = c.image_uri
            return img
        })
    } catch {
        // just a preload; the real click reports any error
    }
}

// how many cards sit in the first row of the grid on screen
function firstRowCount() {
    const grid = document.querySelector<HTMLElement>('[data-page-grid]:not([hidden])')
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
    return columns || 6
}

// wait until the first row of a page's images is decoded (or 3s), so the page appears with its top row filled in
function firstRowReady(cards: CardProps[]) {
    const decoded = cards.slice(0, firstRowCount()).map((c) => {
        let img = warming.find((w) => w.src === c.image_uri)
        if (!img) {
            img = new Image()
            img.src = c.image_uri
        }
        return img.decode().catch(() => { })
    })
    return Promise.race([Promise.all(decoded), new Promise((r) => setTimeout(r, 3000))])
}

// how long a page change has to take before it shows as loading, so a warm preload swaps without a flicker
const PENDING_DELAY = 200

// bumped by every page change; a load that finishes after a newer one started is dropped
let navRun = 0


export function Searchbar() {

    // check if query changed on submit
    // check current page and if there are more


    const [page, setPage] = useState<{ number: number, has_more: boolean, total: number }>({ number: 1, has_more: false, total: 1 })


    const [query, setQuery] = useState<string>('')

    // a page change is in flight: Previous/Next ignore clicks until it lands
    const [busy, setBusy] = useState(false)
    // which button shows the spinner while a load is slow; a new search uses Next
    const [loadingDir, setLoadingDir] = useState<'back' | 'next'>('next')
    const { pending } = useSnapshot(cardsearch)

    async function searchQuery(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault(); // Stop the page from reloading
        // Use FormData to get the value of the input named "query"
        const formData = new FormData(e.currentTarget);
        const queryTerm = formData.get('query')?.toString();
        const submitter = e.nativeEvent.submitter
        const action = submitter?.getAttribute("name") ?? "search"
        if (busy && action !== "search") return
        let termChanged = false
        let tempPage = { number: page.number, has_more: page.has_more }
        const run = ++navRun
        let pendingTimer: ReturnType<typeof setTimeout> | undefined


        try {

            // if there is a queryTerm from input and it's not the same rest
            if (queryTerm && query !== queryTerm) {
                setQuery(queryTerm)
                termChanged = true
                tempPage = { number: 1, has_more: false }
            }


            if (action === "next" && page.has_more) {
                tempPage = { number: page.number + 1, has_more: true }
            }

            if (action === "back" && page.number > 1) {
                tempPage = { number: page.number - 1, has_more: page.has_more }
            }

            const q = termChanged ? queryTerm ?? query : query
            const key = pageKey(q, tempPage.number)

            // already seen this page: show the kept copy, no fetch and no image reload
            const kept = getPage(key)
            if (kept) {
                setPage({ number: tempPage.number, has_more: kept.has_more, total: kept.total_pages })
                setCurrentAlternate('none', '')
                showPage(key)
                preloadNext(q, tempPage.number, kept.has_more)
                return
            }

            // keep the current page up; only mark it as loading if the wait drags on
            setBusy(true)
            setLoadingDir(action === 'back' ? 'back' : 'next')
            pendingTimer = setTimeout(() => { if (run === navRun) cardsearch.pending = true }, PENDING_DELAY)

            let data: PageData
            try {
                data = await loadPage(q, tempPage.number)
                await firstRowReady(data.cards)
            } catch (error) {
                if (run === navRun && termChanged) setPage({ number: 1, has_more: false, total: 1 })
                throw error
            }
            if (run !== navRun) return

            setPage({ number: tempPage.number, has_more: data.has_more, total: data.total_pages })
            setCurrentAlternate('none', '')
            showPage(key, data.cards, data.has_more, data.total_pages);
            preloadNext(q, tempPage.number, data.has_more)
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(`Error: ${error.message}, ${error?.cause}`);
            }
        } finally {
            clearTimeout(pendingTimer)
            if (run === navRun) {
                setBusy(false)
                cardsearch.pending = false
            }
        }
    }

    return (
        // Wrap in a form to catch the "Enter" key and "Submit" events
        <div className={styles.main_content}>
            <form className={styles.searchbar} onSubmit={searchQuery}>
                <input
                    name="query" // Added name so FormData can find it
                    type="text"
                    placeholder='Search for Magic cards...'
                />
                <button type="submit" style={{ display: 'none' }}>Search</button>
                <div className={styles.Pages}>
                    {query ? (
                        <>
                            {/* implament last and first page buttons */}
                            {/* <button name="first">{"<<"}</button> */}
                            <button disabled={busy || !(page.number > 1)} name="back" aria-busy={pending && loadingDir === 'back' || undefined}>
                                <span className={styles.label}>{"< Previous"}</span>
                                <span className={styles.spinner} role="status" aria-label="Loading" />
                            </button>
                            <span>{page.number} of {page.total}</span>
                            <button disabled={busy || !page.has_more} name="next" aria-busy={pending && loadingDir === 'next' || undefined}>
                                <span className={styles.label}>{"Next 175 >"}</span>
                                <span className={styles.spinner} role="status" aria-label="Loading" />
                            </button>
                            {/* <button name="last">{">>"}</button> */}
                        </>
                    ) : null}
                </div>
            </form>
        </div>
    );
}