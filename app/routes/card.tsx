import { useState } from "react";
import { data, Link, redirect, useNavigate } from "react-router";
import { Image } from "@unpic/react";
import type { Route } from "./+types/card";
import styles from "./CardPage.module.css";
import cardStyles from "~/Components/Card/Card.module.css";
import { isScryfallCard, type Ruling, type ScryfallCard } from "~/types";
import { scryfallServerGet, unavailable } from "~/lib/scryfall.server";
import { findCard, sameName } from "~/lib/carddata.server";
import {
  SITE_URL, findPrinting, imageUris, printEntry, printKey, printingCard, priceRange, setPath, slug,
  type PrintEntry, type RelatedCard,
} from "~/lib/carddata";
import { SiteHeader, backLinkClass } from "~/Components/Site/SiteHeader";
import { loadRecord } from "~/lib/card";
import { useCardLayout } from "~/Components/Hooks/useCardLayout";
import { CardText, textFaces } from "~/Components/CardDetails/CardText";
import { Rulings } from "~/Components/CardDetails/Rulings";
import { ShareButton } from "~/Components/CardDetails/ShareButton";
import { PlayFormats } from "~/Components/Card/components/PlayFormats";

const TITLE = "Impulse Caster";

// printings listed when the page loads; the basic lands have over 900, and rendering them all would take
// the page well past the Worker's CPU allowance. "Show all" loads the rest in the browser.
const PRINTS_SHOWN = 36;

type PageData = {
  card: ScryfallCard
  rulings: Ruling[] | null
  prints: PrintEntry[]
  printCount: number
  // this card's page, the printing on screen and the one the page opens on
  slug: string
  selected: string
  main: string
  priceRange: { low: string, high: string } | null
  related: RelatedCard[]
}

// a list Scryfall couldn't give us right now is left out (null) rather than taking the whole page down
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try { return await promise } catch (err) { console.error(err); return null }
}

const scryfallEntry = (c: ScryfallCard): PrintEntry => ({
  key: `${c.set}-${c.collector_number}`,
  set: c.set,
  set_name: c.set_name,
  number: c.collector_number,
  small: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small,
  usd: c.prices?.usd ?? c.prices?.usd_foil ?? c.prices?.usd_etched ?? null,
})

// Without the card data files (local dev, or a card added since the last refresh) the page comes from Scryfall
async function fromScryfall(pageSlug: string, want: string | null, get: (path: string) => Promise<any>): Promise<PageData> {
  let card: unknown
  try {
    if (want) {
      const [set, ...number] = want.split("-")
      card = await get(`cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(number.join("-"))}`)
    } else {
      card = await get(`cards/named?fuzzy=${encodeURIComponent(pageSlug.replace(/-/g, " "))}`)
    }
  } catch (err) {
    unavailable(err)
  }
  if (!isScryfallCard(card)) throw data("Card not found", { status: 404 })
  const found = card
  if (slug(found.name) !== pageSlug) throw redirect(`/card/${slug(found.name)}${want ? `?print=${encodeURIComponent(want)}` : ""}`, 301)

  const [rulings, prints] = await Promise.all([
    orNull((async (): Promise<Ruling[]> => {
      const res = await get(found.rulings_uri)
      if (!Array.isArray(res?.data)) throw new Error(`No rulings list for ${found.id}`)
      return res.data
    })()),
    orNull((async (): Promise<PrintEntry[]> => {
      const res = await get(found.prints_search_uri)
      if (!Array.isArray(res?.data)) throw new Error(`No printings list for ${found.id}`)
      return (res.data as ScryfallCard[]).filter(isScryfallCard).map(scryfallEntry)
    })()),
  ])
  const selected = `${found.set}-${found.collector_number}`
  return {
    card: found, rulings, prints: prints ?? [], printCount: prints?.length ?? 0,
    slug: pageSlug, selected, main: want ? prints?.[0]?.key ?? selected : selected, priceRange: null, related: [],
  }
}

// One page per card, at /card/<name>. Every printing is shown on it: ?print=<set>-<number> picks one.
// Everything comes from the card data files that ship with the site (scripts/card-data.ts), so the page
// only parses its own card's record.
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { ctx, env } = context.cloudflare
  const url = new URL(request.url)
  const pageSlug = params.slug
  const want = url.searchParams.get("print")
  const query = want ? `?print=${encodeURIComponent(want)}` : ""

  // /card/Lightning-Bolt and the like
  if (slug(pageSlug) !== pageSlug) throw redirect(`/card/${slug(pageSlug)}${query}`, 301)

  const record = await findCard(env, pageSlug)
  let page: PageData
  if (!record) {
    page = await fromScryfall(pageSlug, want, (path) => scryfallServerGet(path, request.url, ctx))
  } else {
    let index = record.main
    if (want) {
      index = findPrinting(record, want)
      if (index < 0) {
        // the quick view links by name, so a printing of a card that shares its name (a variant, a token) lands here
        const other = (await sameName(env, record)).find((r) => findPrinting(r, want) >= 0)
        throw redirect(other ? `/card/${other.slug}${query}` : `/card/${record.slug}`, other ? 301 : 302)
      }
    }
    const prints = record.prints.slice(0, PRINTS_SHOWN).map(printEntry)
    if (index >= PRINTS_SHOWN) prints.push(printEntry(record.prints[index]))
    page = {
      card: printingCard(record, record.prints[index]),
      rulings: record.rulings,
      prints,
      printCount: record.prints.length,
      slug: record.slug,
      selected: printKey(record.prints[index]),
      main: printKey(record.prints[record.main]),
      priceRange: priceRange(record),
      related: record.related ?? [],
    }
  }
  // a page missing a list isn't kept, so the next visit (or crawl) gets the whole thing. Browsers check back
  // every time: after a deploy, a copy they kept would point at scripts that are gone. The Worker keeps its own
  // copy for a day (workers/app.ts), so checking back is cheap.
  return data(page, { headers: { "Cache-Control": page.rulings ? "public, no-cache" : "no-store" } })
}

// card data changes about once a day
export function headers({ loaderHeaders, errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? loaderHeaders
}

const faceSummary = (card: ScryfallCard, join: string) =>
  textFaces(card).map((f) => [f.type_line, f.oracle_text].filter(Boolean).join(join)).join(" // ").replace(/\s+/g, " ")

function describe(card: ScryfallCard) {
  const text = faceSummary(card, " — ")
  return text.length > 200 ? `${text.slice(0, 197)}…` : text
}

// what a search result shows under the title: the card's text, then its prices across every printing
function searchDescription(page: PageData) {
  const { card, priceRange: range, printCount } = page
  const prices = range
    ? range.low === range.high ? ` $${range.low}.` : ` From $${range.low} to $${range.high} across ${printCount} printings.`
    : ""
  const text = faceSummary(card, ": ")
  const tail = ` See rulings, format legality and every printing.`
  const room = 300 - prices.length - tail.length - card.name.length - 2
  return `${card.name}: ${text.length > room ? `${text.slice(0, room - 1)}…` : text}${prices}${tail}`
}

// schema.org data so search engines know the page is about this card, its image and its prices
function structuredData(page: PageData, url: string, image: string | undefined) {
  const { card, priceRange: range, printCount } = page
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: card.name,
    url,
    ...(image ? { image } : {}),
    description: faceSummary(card, ": "),
    category: textFaces(card).map((f) => f.type_line).filter(Boolean).join(" // "),
    brand: { "@type": "Brand", name: "Magic: The Gathering" },
    ...(range ? {
      offers: {
        "@type": "AggregateOffer",
        lowPrice: range.low,
        highPrice: range.high,
        priceCurrency: "USD",
        offerCount: printCount,
      },
    } : {}),
  }
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: `Card not found | ${TITLE}` }, { name: "robots", content: "noindex" }]
  const page = data as PageData
  const card = page.card
  // every printing's address points search engines at the card's one page
  const url = `${SITE_URL}/card/${page.slug}`
  const image = card.image_uris?.large ?? card.card_faces?.[0]?.image_uris?.large
  // "<name> price", "<name> rulings" and "<name> legality" are what people search for
  const title = `${card.name} — Price, Rulings & Legality | ${TITLE}`
  const description = describe(card)
  return [
    { title },
    { name: "description", content: searchDescription(page) },
    { name: "theme-color", content: "#1a1515" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: TITLE },
    { property: "og:url", content: url },
    { property: "og:title", content: card.name },
    { property: "og:description", content: description },
    ...(image ? [
      { property: "og:image", content: image },
      { property: "og:image:width", content: "672" },
      { property: "og:image:height", content: "936" },
      { property: "og:image:alt", content: card.name },
      { name: "twitter:image", content: image },
    ] : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: card.name },
    { name: "twitter:description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { "script:ld+json": structuredData(page, url, image) },
  ];
}

const dateFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
const formatDate = (iso: string) => dateFormat.format(new Date(iso))
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const PRICES: { key: keyof ScryfallCard["prices"], label: string, symbol: string }[] = [
  { key: "usd", label: "USD", symbol: "$" },
  { key: "usd_foil", label: "USD foil", symbol: "$" },
  { key: "usd_etched", label: "USD etched", symbol: "$" },
  { key: "eur", label: "EUR", symbol: "€" },
  { key: "eur_foil", label: "EUR foil", symbol: "€" },
  { key: "tix", label: "MTGO", symbol: "" },
]

const STORES: { key: keyof ScryfallCard["purchase_uris"], label: string }[] = [
  { key: "tcgplayer", label: "TCGplayer" },
  { key: "cardmarket", label: "Cardmarket" },
  { key: "cardhoarder", label: "Cardhoarder" },
]

const TURN_ICON = "M627-210q17-33 26-69.5t9-75.5q0-80-35-146.5T532-612l-92 92v-320h320l-92 92q52 47 83 112t31 141q0 91-42.5 165T627-210Zm-427 90 92-92q-53-47-83.5-112T178-465q0-91 42.5-165T334-750q-17 33-26.5 69.5T298-605q0 80 35.5 146.5T428-348l92-92v320H200Z"

// back to the search if that's where we came from (so its results are still there), otherwise home
function BackLink() {
  const navigate = useNavigate()
  return (
    <Link to="/" className={backLinkClass} onClick={(e) => {
      if (window.history.state?.idx > 0) {
        e.preventDefault()
        navigate(-1)
      }
    }}>
      ← Back to search
    </Link>
  )
}

// the address of a printing on this card's page; the one the page opens on needs no ?print=
const printingPath = (page: Pick<PageData, "slug" | "main">, key: string) =>
  `/card/${page.slug}${key === page.main ? "" : `?print=${encodeURIComponent(key)}`}`

// the image with flip/rotate, reset for each printing
function CardMedia({ card, sharePath }: { card: ScryfallCard, sharePath: string }) {
  const { currentFace, canFlip, flip, canRotate, rotate, rotation } = useCardLayout(card)
  const rotationClass = rotation === 180 ? cardStyles.rotate_180 : rotation === 90 ? cardStyles.rotate_90 : rotation === -90 ? cardStyles.rotate_neg_90 : undefined
  return (
    <div className={styles.media}>
      <div className={styles.image}>
        <Image src={currentFace.large_uri || currentFace.image_uri} alt={currentFace.name} width={488} height={680} priority className={rotationClass} />
      </div>
      <div className={styles.actions}>
        {canFlip || canRotate ? (
          <button type="button" className={cardStyles.turn} onClick={canFlip ? flip : rotate}>
            <svg viewBox="0 -960 960 960"><path d={TURN_ICON} /></svg>
            {canFlip ? "Flip" : "Rotate"}
          </button>
        ) : null}
        <ShareButton path={sharePath} name={card.name} className={cardStyles.turn} />
      </div>
    </div>
  )
}

// every printing of the card; picking one swaps it in on this page
function Printings({ page }: { page: PageData }) {
  const [all, setAll] = useState<PrintEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const shown = all ?? page.prints
  const more = !all && page.printCount > page.prints.length

  async function showAll() {
    setLoading(true)
    try {
      const record = await loadRecord(page.card)
      setAll(record ? record.prints.map(printEntry) : page.prints)
    } finally {
      setLoading(false)
    }
  }

  if (page.printCount < 2) return null
  return (
    <section>
      <h2 className={styles.label}>Printings ({page.printCount})</h2>
      <ul className={styles.prints}>
        {shown.map((p) => (
          <li key={p.key}>
            <Link to={printingPath(page, p.key)} replace preventScrollReset className={styles.print} aria-current={p.key === page.selected ? "page" : undefined}>
              {p.small ? <img src={p.small} alt="" width={146} height={204} loading="lazy" /> : null}
              <span className={styles.print_set}>{p.set_name}</span>
              <span className={styles.print_meta}>
                {p.set.toUpperCase()} #{p.number}{p.usd ? ` · $${p.usd}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {more ? (
        <button type="button" className={styles.more} onClick={showAll} disabled={loading}>
          {loading ? "Loading…" : `Show all ${page.printCount} printings`}
        </button>
      ) : null}
    </section>
  )
}

// cards it names or makes, then cards like it; links to their pages
function Related({ cards }: { cards: RelatedCard[] }) {
  if (!cards.length) return null
  return (
    <section>
      <h2 className={styles.label}>Related cards</h2>
      <ul className={styles.prints}>
        {cards.map(([slug, name, id, stamp]) => (
          <li key={slug}>
            <Link to={`/card/${slug}`} className={styles.print}>
              {stamp ? <img src={imageUris(id, "front", stamp).small} alt="" width={146} height={204} loading="lazy" /> : null}
              <span className={styles.print_name}>{name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CardDetail({ page }: { page: PageData }) {
  const { card, rulings } = page
  const prices = PRICES.filter((p) => card.prices?.[p.key])
  const stores = STORES.filter((s) => card.purchase_uris?.[s.key])
  const artists = [...new Set(textFaces(card).map((f) => f.artist).filter(Boolean))].join(" & ") || card.artist
  const links = [
    { label: "EDHREC", href: card.related_uris?.edhrec },
    { label: "Gatherer", href: card.related_uris?.gatherer },
  ].filter((l): l is { label: string, href: string } => !!l.href)

  return (
    <main className={styles.page}>
      {/* a fresh layout (face, rotation) for each printing */}
      <CardMedia key={card.id} card={card} sharePath={printingPath(page, page.selected)} />

      <div className={styles.details}>
        <h1 className={styles.name}>{card.name}</h1>

        <div className={styles.panel}>
          <CardText card={card} showName={false} />
          {artists ? <p className={styles.artist}>Illustrated by {artists}</p> : null}
        </div>

        <section>
          <PlayFormats formats={card.legalities} />
        </section>

        <section>
          <h2 className={styles.label}>This printing</h2>
          <div className={styles.facts}>
            <div>
              <span className={styles.fact_label}>Set</span>
              <Link to={setPath(card.set)} className={styles.set_link}>{card.set_name} ({card.set.toUpperCase()})</Link>
            </div>
            <div>
              <span className={styles.fact_label}>Number</span>
              <span>#{card.collector_number}</span>
            </div>
            <div>
              <span className={styles.fact_label}>Rarity</span>
              <span>{capitalize(card.rarity)}</span>
            </div>
            <div>
              <span className={styles.fact_label}>Released</span>
              <span>{formatDate(card.released_at)}</span>
            </div>
            {card.edhrec_rank ? (
              <div>
                <span className={styles.fact_label}>EDHREC rank</span>
                <span>#{card.edhrec_rank.toLocaleString()}</span>
              </div>
            ) : null}
            {card.reserved ? (
              <div>
                <span className={styles.fact_label}>Reserved list</span>
                <span>Yes</span>
              </div>
            ) : null}
          </div>
        </section>

        {prices.length || stores.length ? (
          <section>
            <h2 className={styles.label}>Prices</h2>
            <div className={styles.prices}>
              {prices.map((p) => (
                <div key={p.key} className={styles.price}>
                  <span className={styles.fact_label}>{p.label}</span>
                  <span>{p.symbol}{card.prices[p.key]}{p.key === "tix" ? " tix" : ""}</span>
                </div>
              ))}
            </div>
            {stores.length ? (
              <div className={styles.links}>
                {stores.map((s) => <a key={s.key} href={card.purchase_uris[s.key]} target="_blank" rel="noopener noreferrer">Buy on {s.label}</a>)}
              </div>
            ) : null}
          </section>
        ) : null}

        <Rulings rulings={rulings} />

        {/* a new card starts with its own list */}
        <Printings key={page.slug} page={page} />

        <Related cards={page.related} />

        {links.length ? (
          <section>
            <h2 className={styles.label}>More on this card</h2>
            <div className={styles.links}>
              {links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

export default function CardPage({ loaderData }: Route.ComponentProps) {
  const page = loaderData as PageData
  return (
    <div>
      <SiteHeader>
        <BackLink />
      </SiteHeader>
      <CardDetail page={page} />
    </div>
  )
}
