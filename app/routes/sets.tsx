import { data } from "react-router";
import type { Route } from "./+types/sets";
import styles from "./Sets.module.css";
import { allSets } from "~/lib/carddata.server";
import { SITE_URL, setPath } from "~/lib/carddata";
import { SiteHeader } from "~/Components/Site/SiteHeader";

const TITLE = "Impulse Caster";
const DESCRIPTION = "Every Magic: The Gathering set, from Alpha to the latest release: expansions, Commander decks, Masters sets, promos and more, with a full card list and prices for each.";

// Scryfall's set types, grouped the way players think of them; anything not listed goes under "Other products".
// The groups after the main ones hold hundreds of small sets, so they're a plain list of names: the whole page
// has to render inside the Worker's CPU allowance. For the same reason the sets are plain links: 800 <Link>s
// take three times as long to render.
const GROUPS: { label: string, types: string[], compact?: true }[] = [
  { label: "Expansions and core sets", types: ["expansion", "core"] },
  { label: "Commander", types: ["commander"] },
  { label: "Masters and reprint sets", types: ["masters", "eternal", "draft_innovation", "from_the_vault", "spellbook", "premium_deck", "duel_deck", "arsenal"] },
  { label: "Digital", types: ["alchemy"] },
  { label: "Promos", types: ["promo"], compact: true },
  { label: "Tokens and memorabilia", types: ["token", "memorabilia"], compact: true },
]

// [code, name, release year, cards, icon]; just [code, name] in the compact groups
type SetRow = [string, string, string?, number?, string?]

export async function loader({ context }: Route.LoaderArgs) {
  const sets = await allSets(context.cloudflare.env)
  if (!sets) throw data("The list of sets isn't available right now", { status: 503 })
  const all = [...GROUPS.slice(0, -2), { label: "Other products", types: [] as string[], compact: true as const }, ...GROUPS.slice(-2)]
  const groups = all.map((g) => ({ label: g.label, compact: !!g.compact, sets: [] as SetRow[] }))
  const other = all.findIndex((g) => !g.types.length)
  for (const s of sets) {
    const at = all.findIndex((g) => g.types.includes(s.type))
    const group = groups[at < 0 ? other : at]
    group.sets.push(group.compact ? [s.code, s.name] : s.icon ? [s.code, s.name, s.released.slice(0, 4), s.count, s.icon] : [s.code, s.name, s.released.slice(0, 4), s.count])
  }
  return data({ groups: groups.filter((g) => g.sets.length), total: sets.length }, { headers: { "Cache-Control": "public, no-cache" } })
}

export function headers({ loaderHeaders, errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? loaderHeaders
}

export function meta() {
  const title = `All Magic: The Gathering Sets | ${TITLE}`
  return [
    { title },
    { name: "description", content: DESCRIPTION },
    { name: "theme-color", content: "#1a1515" },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: TITLE },
    { property: "og:url", content: `${SITE_URL}/sets` },
    { property: "og:title", content: title },
    { property: "og:description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/sets` },
  ]
}

export default function Sets({ loaderData }: Route.ComponentProps) {
  const { groups, total } = loaderData
  return (
    <div>
      <SiteHeader />
      <main className={styles.page}>
        <h1 className={styles.title}>All sets</h1>
        <p className={styles.intro}>{total.toLocaleString()} Magic: The Gathering sets, newest first. Pick one to see every card in it.</p>
        <nav className={styles.jump} aria-label="Kinds of set">
          {groups.map((g, i) => <a key={g.label} href={`#group-${i}`}>{g.label}</a>)}
        </nav>
        {groups.map((g, i) => (
          <section key={g.label} id={`group-${i}`} className={styles.group}>
            <h2 className={styles.label}>{g.label} ({g.sets.length})</h2>
            {g.compact ? (
              <p className={styles.compact}>
                {g.sets.map(([code, name]) => <a key={code} href={setPath(code)}>{name}</a>)}
              </p>
            ) : <ul className={styles.sets}>
              {g.sets.map(([code, name, year, count, icon]) => (
                <li key={code}>
                  <a href={setPath(code)} className={styles.set}>
                    {icon ? <img src={icon} alt="" width={20} height={20} loading="lazy" /> : <span className={styles.no_icon} />}
                    <span className={styles.set_name}>{name}</span>
                    <span className={styles.set_meta}>{code.toUpperCase()} · {year} · {count} cards</span>
                  </a>
                </li>
              ))}
            </ul>}
          </section>
        ))}
      </main>
    </div>
  )
}
