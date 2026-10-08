import { hasData, hasStatus, isScryfallCard, type CardProps, type ImageUris, type ScryfallCard } from '~/types'
import styles from './Searchbar.module.css'
import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react' // Use FormEvent for form submissions
import { useSnapshot } from 'valtio';
import { useLocation, useNavigate } from 'react-router';
import { cardsearch, getPage, hidePages, pageKey, showPage } from '../Context/cards';
import { scryfallGet } from '~/lib/scryfall';
import { setCurrentAlternate } from '../Card/components/alternate_arts';
import { QueryInput } from './QueryInput';
import { RowSize } from '../CardGrid/RowSize';
import { NoResults } from './NoResults';
import { chipId, querybox } from '../Context/query';
import { buildQuery, parseQuery, type Chip } from './filters';
import { loadCatalog } from './catalog';
import { readSearchUrl, searchUrl } from './searchUrl';
import { sort, sortKey } from '../Context/sort';
import { SortControl } from './SortControl';
import { Arrow } from '../Arrow/Arrow';
import { view } from '../Context/view';

type Sort = { order: string, dir: string }

const SETTINGS_ICON = "m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"


async function searchCard(page: number, query: string, by: Sort) {
    const params = new URLSearchParams({
        page: String(page),
        q: query,
        include_extras: "false",
        include_multilingual: "false",
        include_variations: "false",
        order: by.order,
        dir: by.dir,
        unique: "cards",
    })
    return scryfallGet(`cards/search?${params}`)
}

type KeptChip = Omit<Chip, 'id'>

// the chips as plain data, to keep with the address in the browser's history (which can't hold the live proxies)
const keptChips = (chips: readonly Chip[]): KeptChip[] => JSON.parse(JSON.stringify(chips.map(({ id, ...c }) => c)))

// the chips kept with an address, if it has any
function chipsOf(state: unknown): KeptChip[] | null {
    const chips = (state as { chips?: unknown } | null)?.chips
    return Array.isArray(chips) ? chips : null
}

type PageData = { cards: CardProps[], has_more: boolean, total_pages: number, total_cards: number }

// a search Scryfall answered with an error or no cards, with its explanation
class SearchError extends Error {
    constructor(readonly status: number, readonly details: string, readonly warnings: string[] = []) {
        super(`${status}`, { cause: details })
    }
}

// Scryfall returns up to 175 cards per search page
const PAGE_SIZE = 175

// page data by query+page, shared by real searches and prefetches so Next reuses an in-flight prefetch
const pageData = new Map<string, Promise<PageData>>()
const MAX_PAGE_DATA = 20
// what Scryfall left out of each search, by query
const skippedBy = new Map<string, string[]>()

// the same search sorted another way is a different set of pages
const resultKey = (query: string, by: Sort, page: number) => pageKey(`${query}\u0001${sortKey(by)}`, page)

function loadPage(query: string, page: number, by: Sort): Promise<PageData> {
    const key = resultKey(query, by, page)
    let data = pageData.get(key)
    if (!data) {
        data = searchCard(page, query, by).then((res) => {
            // see if there were any errors
            if (hasStatus(res) || !hasData(res)) throw new SearchError(Number(res?.status) || 0, res?.details ?? '', Array.isArray(res?.warnings) ? res.warnings : []);

            const validCards = res.data.filter(isScryfallCard);
            if (validCards.length === 0) throw new SearchError(404, 'No Cards Found');

            const cards: CardProps[] = validCards
                .map(c => { return { name: c.name, image_uri: c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal, card_uri: c.uri, card:c } }).filter((card): card is CardProps => !!card?.image_uri);
            // Scryfall still finds cards when it drops part of a search (a regex too long, say), and says so here
            skippedBy.set(query, Array.isArray(res.warnings) ? res.warnings : [])
            if (skippedBy.size > MAX_PAGE_DATA) skippedBy.delete(skippedBy.keys().next().value!)
            const total_cards = res.total_cards ?? cards.length
            const total_pages = Math.max(1, Math.ceil(total_cards / PAGE_SIZE))
            return { cards, has_more: !!res.has_more, total_pages, total_cards }
        })
        // don't keep failures around, so the next try fetches again
        data.catch(() => pageData.delete(key))
        pageData.set(key, data)
        if (pageData.size > MAX_PAGE_DATA) pageData.delete(pageData.keys().next().value!)
    }
    return data
}

// how many cards a search finds; the page it loads is kept, so searching it for real afterwards is instant
const countCards = (query: string) => loadPage(query, 1, { ...sort }).then((d) => d.total_cards, (e) => {
    if (e instanceof SearchError && e.status === 404) return 0
    throw e
})

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
async function preloadNext(query: string, page: number, has_more: boolean, by: Sort) {
    const run = ++preloadRun
    for (const img of warming) img.removeAttribute('src')
    warming = []
    if (!has_more || getPage(resultKey(query, by, page + 1))) return

    try {
        const next = await loadPage(query, page + 1, by)
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

// the widest screen the header tucks away on as the results scroll (matches the phone layout in the CSS),
// and how far a scroll has to go before it counts
const PHONE_WIDTH = 640
const SCROLL_SLACK = 8

// how long a page change has to take before it shows as loading, so a warm preload swaps without a flicker
const PENDING_DELAY = 200

// bumped by every page change; a load that finishes after a newer one started is dropped
let navRun = 0


type PageState = { number: number, has_more: boolean, total: number, cards: number }

// what the header showed last, so coming back from a card's page picks up where the results left off
// `url` is the address of the results on screen
const remembered: { page: PageState, query: string, sort: Sort | null, url: string } = { page: { number: 1, has_more: false, total: 1, cards: 0 }, query: '', sort: null, url: '' }

// one setting in the layout pop-up: its name, a Reset back to the default (live only once it's been changed), and its control
function Setting({ label, changed, reset, children }: { label: string, changed: boolean, reset: () => void, children: ReactNode }) {
    return (
        <div className={styles.setting}>
            <div className={styles.settingHead}>
                <span>{label}</span>
                <button type="button" className={styles.settingReset} onClick={reset} disabled={!changed} aria-label={`Reset ${label.toLowerCase()}`}>Reset</button>
            </div>
            {children}
        </div>
    )
}

export function Searchbar() {

    // check if query changed on submit
    // check current page and if there are more


    const [page, setPage] = useState<PageState>(remembered.page)


    const [query, setQuery] = useState<string>(remembered.query)
    useEffect(() => { remembered.page = page; remembered.query = query }, [page, query])

    // a page change is in flight: Previous/Next ignore clicks until it lands
    const [busy, setBusy] = useState(false)
    // which button shows the spinner while a load is slow; a new search uses Next
    const [loadingDir, setLoadingDir] = useState<'back' | 'next'>('next')
    const { pending } = useSnapshot(cardsearch)
    const { perRow } = useSnapshot(view)
    const formRef = useRef<HTMLFormElement>(null)
    // cards per row is set in a layout settings pop-up, opened from the gear across from the logo
    const settingsRef = useRef<HTMLDialogElement>(null)
    const settingsTitle = useId()
    const headerRef = useRef<HTMLDivElement>(null)

    const pagesRef = useRef<HTMLDivElement>(null)

    // On phones the header can take half the screen (the chip tray grows with every filter), so scrolling down the results slides it up under the
    // top edge until only the results strip (count and pages) is left; scrolling up brings it all back. It moves by
    // its sticky `top`, not a transform, which would trap the filter panel's full-screen `position: fixed` inside it.
    // The part on screen is published as --header-height, so the open compare drawer sits flush under it
    // (the header grows with the chip tray and the results rows).
    useEffect(() => {
        const header = headerRef.current
        if (!header) return
        const root = document.documentElement
        const phone = matchMedia(`(max-width: ${PHONE_WIDTH}px)`)
        let tucked = false
        let lastY = scrollY

        function apply() {
            const height = header!.getBoundingClientRect().height
            const keep = pagesRef.current?.offsetHeight ?? 0
            const offset = tucked ? Math.max(0, height - keep) : 0
            header!.style.top = offset ? `${-offset}px` : ''
            root.style.setProperty('--header-height', `${height - offset}px`)
        }
        function tuck(next: boolean) {
            if (next === tucked) return
            tucked = next
            apply()
        }
        function onScroll() {
            const y = scrollY
            // small wobbles (a finger resting, the bounce at the top) don't count
            if (Math.abs(y - lastY) < SCROLL_SLACK) return
            const down = y > lastY
            lastY = y
            // only once the header's own place has scrolled by, and never while something in it has focus (typing a name)
            tuck(phone.matches && down && y > header!.offsetHeight && !header!.contains(document.activeElement))
        }

        const observer = new ResizeObserver(apply)
        observer.observe(header)
        const show = () => tuck(false)
        addEventListener('scroll', onScroll, { passive: true })
        // tabbing into it, or turning the phone sideways, brings it back
        header.addEventListener('focusin', show)
        phone.addEventListener('change', show)
        return () => {
            observer.disconnect()
            removeEventListener('scroll', onScroll)
            header.removeEventListener('focusin', show)
            phone.removeEventListener('change', show)
            header.style.top = ''
            root.style.removeProperty('--header-height')
        }
    }, [])
    // the sort of the results on screen; Previous/Next page through those, a new search picks up the current sort
    const shownSort = useRef<Sort>(remembered.sort ?? { ...sort })
    const location = useLocation()
    const navigate = useNavigate()
    // the address of the search on screen or on its way, so a search made here isn't run again when the address catches up
    const requested = useRef(remembered.url)
    // leaving for a card's page: a page load still in flight is dropped, so it can't swap the results
    // behind the header's back (the header is gone, so its page number wouldn't follow)
    useEffect(() => () => {
        remembered.sort = shownSort.current
        navRun++
        // and it's no longer on its way, so coming back to its address loads it again
        requested.current = remembered.url
        cardsearch.pending = false
    }, [])

    // show page `number` of a search: the kept copy if we've seen it, otherwise loaded. `isSearch` is a new search
    // rather than paging, so finding nothing gets the pop-up. `url` is the address it's at, remembered once it lands.
    async function go(q: string, by: Sort, number: number, isSearch: boolean, url: string) {
        const run = ++navRun
        let pendingTimer: ReturnType<typeof setTimeout> | undefined
        // a different search or sort starts over, so the header resets if it fails
        const termChanged = q !== query || sortKey(by) !== sortKey(shownSort.current)
        if (q !== query) setQuery(q)
        const key = resultKey(q, by, number)

        try {
            // already seen this page: show the kept copy, no fetch and no image reload
            const kept = getPage(key)
            if (kept) {
                setPage({ number, has_more: kept.has_more, total: kept.total_pages, cards: kept.total_cards })
                setCurrentAlternate('none', '')
                shownSort.current = by
                remembered.url = url
                showPage(key)
                preloadNext(q, number, kept.has_more, by)
                return
            }

            // keep the current page up; only mark it as loading if the wait drags on
            setBusy(true)
            setLoadingDir(!termChanged && number < page.number ? 'back' : 'next')
            pendingTimer = setTimeout(() => { if (run === navRun) cardsearch.pending = true }, PENDING_DELAY)

            let data: PageData
            try {
                data = await loadPage(q, number, by)
                await firstRowReady(data.cards)
            } catch (error) {
                if (run === navRun) {
                    remembered.url = url
                    if (termChanged) setPage({ number: 1, has_more: false, total: 1, cards: 0 })
                }
                throw error
            }
            if (run !== navRun) return

            setPage({ number, has_more: data.has_more, total: data.total_pages, cards: data.total_cards })
            setCurrentAlternate('none', '')
            shownSort.current = by
            remembered.url = url
            showPage(key, data.cards, data.has_more, data.total_pages, data.total_cards);
            preloadNext(q, number, data.has_more, by)
        } catch (error: unknown) {
            // a search that found nothing gets the pop-up explaining why; paging errors just log
            if (run === navRun && isSearch && error instanceof SearchError && (error.status === 404 || error.status === 400)) {
                querybox.noResults = { query: q, status: error.status, details: error.details, warnings: error.warnings }
            }
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

    function searchQuery(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault(); // Stop the page from reloading
        const submitter = e.nativeEvent.submitter
        const action = submitter?.getAttribute("name") ?? "search"
        if (busy && action !== "search") return
        const by: Sort = action === 'search' ? { ...sort } : shownSort.current
        // a search is for the chips as they are now; Previous/Next page through the search on screen
        const q = action === 'search' ? buildQuery(querybox.chips) : query
        if (!q) {
            // every filter taken out: back to no search
            if (query) navigate({ search: '' }, { preventScrollReset: true })
            return
        }

        // a new search or sort starts over at the first page
        let number = page.number
        if (q !== query || sortKey(by) !== sortKey(shownSort.current)) number = 1
        else if (action === "next" && page.has_more) number++
        else if (action === "back" && page.number > 1) number--

        // each new search or page is a step in the history, so Back returns to it; the same one again just shows it again
        const url = searchUrl({ q, ...by, page: number })
        requested.current = url
        // the chips go with the address, so a refresh or Back brings back these chips rather than ones read from the search
        const chips = action === 'search' ? keptChips(querybox.chips) : chipsOf(location.state)
        navigate({ search: url }, { replace: url === location.search, preventScrollReset: true, state: chips && { chips } })
        go(q, by, number, action === 'search', url)
    }

    // the address changed without a search being made here: opened from a link, refreshed, or Back/Forward
    useEffect(() => {
        const target = readSearchUrl(location.search)
        const url = searchUrl(target)
        if (url === requested.current) return
        requested.current = url

        if (!target) {
            // back to before the first search
            navRun++
            setQuery('')
            setPage({ number: 1, has_more: false, total: 1, cards: 0 })
            setBusy(false)
            remembered.url = ''
            Object.assign(querybox, { chips: [], noResults: null })
            hidePages()
            return
        }

        const by: Sort = { order: target.order, dir: target.dir }
        sort.order = target.order
        sort.dir = target.dir
        const kept = chipsOf(location.state)
        if (buildQuery(querybox.chips) !== target.q && kept && buildQuery(kept) === target.q) {
            // the chips this search was made with, kept with the address
            querybox.noResults = null
            querybox.chips = kept.map((c) => ({ ...c, id: chipId() }))
        } else if (buildQuery(querybox.chips) !== target.q) {
            querybox.noResults = null
            // creature types need their list to come back as creature chips; the search doesn't wait for it
            loadCatalog('creature-types').catch(() => { }).then(() => {
                if (requested.current !== url) return
                querybox.chips = parseQuery(target.q).map((c) => ({ id: chipId(), ...c }))
            })
        }
        const isSearch = target.q !== query || sortKey(by) !== sortKey(shownSort.current) || target.page === 1
        go(target.q, by, target.page, isSearch, url)
    }, [location.search])

    return (
        <div className={styles.main_content} ref={headerRef}>
            {/* a search is the form's submit: the filters panel, a sort menu or Previous/Next send it. Enter in a
                filter's field never does, since it would press the first button in the form, Previous page */}
            <form className={styles.headerRow} onSubmit={searchQuery} ref={formRef}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault() }}>
                <a className={styles.brand} href="/">
                    <img src="/logo.svg" alt="" width={40} height={40} />
                    <span>Impulse Caster</span>
                </a>
                <button type="button" className={styles.settingsButton} aria-label="Layout settings" aria-haspopup="dialog"
                    onClick={() => settingsRef.current?.showModal()}>
                    <svg viewBox="0 -960 960 960" aria-hidden><path d={SETTINGS_ICON} /></svg>
                </button>
                <div className={styles.searchArea}>
                    <QueryInput searched={query} skipped={skippedBy.get(query)} />
                </div>
                <div className={styles.viewOptions}>
                    <SortControl onChange={() => { if (query) formRef.current?.requestSubmit() }} />
                </div>
                <div className={styles.Pages} ref={pagesRef}>
                    {query ? (
                        <>
                            {page.cards > 0 && (
                                <span className={styles.count}>{page.cards.toLocaleString()} {page.cards === 1 ? 'card' : 'cards'}</span>
                            )}
                            {/* implament last and first page buttons */}
                            {/* <button name="first">{"<<"}</button> */}
                            <button disabled={busy || !(page.number > 1)} name="back" aria-label="Previous page" aria-busy={pending && loadingDir === 'back' || undefined}>
                                <span className={styles.label}><Arrow to="left" /></span>
                                <span className={styles.spinner} role="status" aria-label="Loading" />
                            </button>
                            <span className={styles.pageOf}>{page.number} of {page.total}</span>
                            <button disabled={busy || !page.has_more} name="next" aria-label="Next page" aria-busy={pending && loadingDir === 'next' || undefined}>
                                <span className={styles.label}><Arrow to="right" /></span>
                                <span className={styles.spinner} role="status" aria-label="Loading" />
                            </button>
                            {/* <button name="last">{">>"}</button> */}
                        </>
                    ) : null}
                </div>
            </form>
            <dialog ref={settingsRef} className={styles.settings} aria-labelledby={settingsTitle}
                onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close() }}>
                <div className={styles.settingsBody}>
                    <div className={styles.settingsHead}>
                        <h2 id={settingsTitle}>Layout settings</h2>
                        <button type="button" className={styles.settingsClose} aria-label="Close" onClick={() => settingsRef.current?.close()}>×</button>
                    </div>
                    <Setting label="Number of cards shown" changed={!!perRow} reset={() => view.perRow = 0}>
                        <RowSize />
                    </Setting>
                </div>
            </dialog>
            <NoResults count={countCards} research={() => requestAnimationFrame(() => formRef.current?.requestSubmit())} />
        </div>
    );
}