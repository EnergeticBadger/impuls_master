import { hasData, hasStatus, isScryfallCard, type ImageUris, type ScryfallCard, } from '~/types'
import styles from './Searchbar.module.css'
import type { SubmitEvent } from 'react'



export function Searchbar({ setCards }: { setCards: React.Dispatch<React.SetStateAction<ImageUris[]>> }) {


    async function searchQuery(e: SubmitEvent<HTMLInputElement>) {

        try {

            console.log('event val:', e.currentTarget.value)

            const blob = await fetch(`https://api.scryfall.com/cards/search?q=${e.currentTarget.value}`, {
                method: "GET",
                headers: {
                    "Accept": "*/*",
                    "User-Agent": "impuls_master/1.0"
                }
            })

            console.log('blob', blob)

            const res = await blob.json()

            if (hasStatus(res)) {
                throw new Error(`${res.status}`, { cause: res.details })
            }

            // Using the guard you built earlier to clean up an API response:
            if (hasData<ScryfallCard>(res)) {
                const validCards = res.data.filter(isScryfallCard);
                // Now validCards is ScryfallCard[]
                if (validCards.length === 0) {
                    throw new Error('200', { cause: 'No Cards Found' })
                }


                const largImages: ImageUris[] = []

                validCards.map((c) => {
                    if (c.image_uris) {
                        largImages.push(c.image_uris)
                    }
                })

                console.log('largImages: ', largImages)
                setCards(largImages)
            }


        } catch (error: unknown) {
            if (error instanceof Error) {
                console.error(`Error: ${error.message}, ${error?.cause}`)
            }
        }



    }

    return (
        <div className={styles.searchbar}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#FFFFFF"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" /></svg>
            <form>
                <input type="text" placeholder='Search for Magic cards...' onSubmit={(e) => searchQuery(e)} />
            </form>
        </div>
    )
}