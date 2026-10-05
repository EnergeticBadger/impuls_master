import { data, Link, redirect } from "react-router";
import type { Route } from "./+types/set";
import styles from "./Sets.module.css";
import { findSet } from "~/lib/carddata.server";
import { SET_PAGE, SITE_URL, imageUris, setPath, type SetCard, type SetSummary } from "~/lib/carddata";
import { SiteHeader } from "~/Components/Site/SiteHeader";
import { searchUrl } from "~/Components/Searchbar/searchUrl";

const TITLE = "Impulse Caster";

const TYPE_NAMES: Record<string, string> = {
  expansion: "Expansion", core: "Core set", masters: "Masters set", draft_innovation: "Draft innovation set",
  commander: "Commander", eternal: "Eternal set", promo: "Promos", alchemy: "Alchemy (digital)", funny: "Un-set",
  duel_deck: "Duel Decks", from_the_vault: "From the Vault", premium_deck: "Premium Deck", spellbook: "Signature Spellbook",
  box: "Box set", starter: "Starter set", memorabilia: "Memorabilia", masterpiece: "Masterpiece series",
  planechase: "Planechase", archenemy: "Archenemy", treasure_chest: "Treasure chest", minigame: "Minigame", arsenal: "Arsenal",
}
const typeName = (type: string) => TYPE_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")

const dateFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
const formatDate = (iso: string) => dateFormat.format(new Date(iso))

type PageData = { set: SetSummary, cards: SetCard[], page: number, pages: number }

// /sets/<code>: every card in a set, by collector number, a page of SET_PAGE at a time (?page=2...)
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const code = params.code.toLowerCase()
  if (code !== params.code) throw redirect(`/sets/${code}${new URL(request.url).search}`, 301)
  if (!/^[a-z0-9]+$/.test(code)) throw data("Set not found", { status: 404 })
  const found = await findSet(context.cloudflare.env, code)
  if (found === undefined) throw data("Sets aren't available right now", { status: 503 })
  if (!found) throw data("Set not found", { status: 404 })

  const { cards, ...set } = found
  const pages = Math.max(1, Math.ceil(cards.length / SET_PAGE))
  const asked = new URL(request.url).searchParams.get("page")
  const page = asked === null ? 1 : Number(asked)
  // one address per page: ?page=1 and pages past the end go to the real ones
  if (asked !== null && (!Number.isInteger(page) || page < 1 || page > pages || page === 1)) {
    throw redirect(setPath(code, Number.isInteger(page) && page > 1 ? pages : 1), 301)
  }
  const shown = cards.slice((page - 1) * SET_PAGE, page * SET_PAGE)
  return data({ set, cards: shown, page, pages } satisfies PageData, { headers: { "Cache-Control": "public, no-cache" } })
}

export function headers({ loaderHeaders, errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? loaderHeaders
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: `Set not found | ${TITLE}` }, { name: "robots", content: "noindex" }]
  const { set, page, pages } = data as PageData
  const url = `${SITE_URL}${setPath(set.code, page)}`
  const pageNote = pages > 1 && page > 1 ? ` (page ${page} of ${pages})` : ""
  const title = `${set.name} (${set.code.toUpperCase()}) Card List & Prices${pageNote} | ${TITLE}`
  const description = `All ${set.count} cards in ${set.name} (${set.code.toUpperCase()}), released ${formatDate(set.released)}. See each card's price, rulings, format legality and other printings.`
  return [
    { title },
    { name: "description", content: description },
    { name: "theme-color", content: "#1a1515" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: TITLE },
    { property: "og:url", content: url },
    { property: "og:title", content: `${set.name} card list` },
    { property: "og:description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    ...(page > 1 ? [{ tagName: "link", rel: "prev", href: `${SITE_URL}${setPath(set.code, page - 1)}` }] : []),
    ...(page < pages ? [{ tagName: "link", rel: "next", href: `${SITE_URL}${setPath(set.code, page + 1)}` }] : []),
  ]
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// page 1 2 3 ... links; every page is linked so all the cards are a click or two from the set
function Pages({ code, page, pages }: { code: string, page: number, pages: number }) {
  if (pages < 2) return null
  return (
    <nav className={styles.pager} aria-label="Pages">
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <Link key={n} to={setPath(code, n)} aria-current={n === page ? "page" : undefined}>{n}</Link>
      ))}
    </nav>
  )
}

export default function SetPage({ loaderData }: Route.ComponentProps) {
  const { set, cards, page, pages } = loaderData as PageData
  const from = (page - 1) * SET_PAGE + 1
  return (
    <div>
      <SiteHeader>
        <Link to="/sets" className={styles.header_link}>All sets</Link>
      </SiteHeader>
      <main className={styles.page}>
        <div className={styles.set_head}>
          {set.icon ? <img src={set.icon} alt="" width={48} height={48} className={styles.set_icon} /> : null}
          <div>
            <h1 className={styles.title}>{set.name}</h1>
            <p className={styles.intro}>
              {set.code.toUpperCase()} · {typeName(set.type)}{set.digital ? " · Digital only" : ""} · Released {formatDate(set.released)} · {set.count} cards
            </p>
          </div>
        </div>
        <div className={styles.toolbar}>
          <Link to={`/${searchUrl({ q: `e:${set.code}`, order: "name", dir: "auto", page: 1 })}`} className={styles.search_link}>Search this set</Link>
          {pages > 1 ? <span className={styles.count}>Cards {from}–{from + cards.length - 1} of {set.count}</span> : null}
        </div>
        <Pages code={set.code} page={page} pages={pages} />
        <ul className={styles.cards}>
          {cards.map(([slug, name, number, rarity, id, stamp, usd, main]) => (
            <li key={`${number}-${slug}`}>
              <Link to={`/card/${slug}${main ? "" : `?print=${encodeURIComponent(`${set.code}-${number}`)}`}`} className={styles.card}>
                {stamp ? <img src={imageUris(id, "front", stamp).small} alt="" width={146} height={204} loading="lazy" /> : <span className={styles.no_image} />}
                <span className={styles.card_name}>{name}</span>
                <span className={styles.card_meta}>#{number} · {capitalize(rarity)}{usd ? ` · $${usd}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Pages code={set.code} page={page} pages={pages} />
      </main>
    </div>
  )
}
