import { hasData, hasStatus, isScryfallCard, type CardProps, type ImageUris, type ScryfallCard } from '~/types'
import styles from './Searchbar.module.css'
import { useState, type SubmitEvent } from 'react' // Use FormEvent for form submissions
import { getPage, pageKey, showPage } from '../Context/cards';
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



export function Searchbar() {

    // check if query changed on submit
    // check current page and if there are more


    const [page, setPage] = useState<{ number: number, has_more: boolean }>({ number: 1, has_more: false })


    const [query, setQuery] = useState<string>('')

    async function searchQuery(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault(); // Stop the page from reloading
        // Use FormData to get the value of the input named "query"
        const formData = new FormData(e.currentTarget);
        const queryTerm = formData.get('query')?.toString();
        const submitter = e.nativeEvent.submitter
        const action = submitter?.getAttribute("name") ?? "search"
        let termChanged = false
        let tempPage = { number: page.number, has_more: page.has_more }


        try {

            // if there is a queryTerm from input and it's not the same rest
            if (queryTerm && query !== queryTerm) {
                setQuery(queryTerm)
                termChanged = true
                tempPage = { number: 1, has_more: false }
                setPage({ number: 1, has_more: false })
            }


            if (action === "next" && page.has_more) {
                tempPage = { number: page.number + 1, has_more: true }
                setPage((p) => { return { number: p.number + 1, has_more: true } })
            }

            if (action === "back" && page.number > 1) {
                tempPage = { number: page.number - 1, has_more: page.has_more }
                setPage((p) => { return { number: p.number - 1, has_more: p.has_more } })
            }

            const q = termChanged ? queryTerm ?? query : query
            const key = pageKey(q, tempPage.number)

            // already seen this page: show the kept copy, no fetch and no image reload
            const kept = getPage(key)
            if (kept) {
                setPage({ number: tempPage.number, has_more: kept.has_more })
                setCurrentAlternate('none', '')
                showPage(key)
                return
            }

            // fetch data
            const res = await searchCard(tempPage.number, q)


            // see if there were any errors
            if (hasStatus(res) || !hasData(res)) {
                setPage({ number: 1, has_more: false })
                throw new Error(`${res.status}`, { cause: res.details });
            }

            if (res.has_more) {
                setPage((p) => { return { number: p.number, has_more: true } })
            } else {
                setPage((p) => { return { number: p.number, has_more: false } })
            }

            const validCards = res.data.filter(isScryfallCard);
             

            if (validCards.length === 0) {
                setPage({ number: 1, has_more: false })
                throw new Error('200', { cause: 'No Cards Found' });
            }

            // Optimization: Use .map and .filter or .flatMap instead of creating a let array
            const largeImages: CardProps[] = validCards
                .map(c => { return { name: c.name, image_uri: c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal, card_uri: c.uri, card:c } }).filter((card): card is CardProps => !!card?.image_uri);

            setCurrentAlternate('none', '')
            showPage(key, largeImages, !!res.has_more);
        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(`Error: ${error.message}, ${error?.cause}`);
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
                            <button disabled={!(page.number > 1)} name="back">{"< Previous"}</button>
                            <span>Page: {page.number}</span>
                            <button disabled={!page.has_more} name="next">{" Next 175 >"}</button>
                            {/* <button name="last">{">>"}</button> */}
                        </>
                    ) : null}
                </div>
            </form>
        </div>
    );
}