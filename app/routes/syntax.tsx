import { Link } from "react-router";
import type { ReactNode } from "react";
import type { Route } from "./+types/syntax";
import styles from "./Syntax.module.css";
import { SITE_URL } from "~/lib/carddata";
import { SiteHeader } from "~/Components/Site/SiteHeader";
import { searchUrl } from "~/Components/Searchbar/searchUrl";

const TITLE = "Impulse Caster";
const PAGE_TITLE = `MTG Card Search Syntax Guide | ${TITLE}`;
const DESCRIPTION = "How to search for Magic: The Gathering cards by color, type, rules text, mana cost, power, rarity, set, format, price and more, with an example search for every keyword.";

// The search runs on Scryfall's engine, so this is the syntax it understands. Every example is a link that runs it.
type Section = { id: string, title: string, intro: ReactNode, examples: [string, string][] }

const SECTIONS: Section[] = [
  {
    id: "basics",
    title: "The basics",
    intro: <>
      Words on their own search card names, so <code>goblin</code> finds every card with "goblin" in its name. Everything
      else is a keyword, a colon and a value, like <code>t:goblin</code>. Put several terms in one search and a card has
      to match all of them. Put quotes around a value with spaces or punctuation: <code>o:"draw a card"</code>.
    </>,
    examples: [
      ["goblin", "Cards with \"goblin\" in the name"],
      ["t:goblin c:r mv<=2", "Red Goblins with mana value 2 or less"],
      ["!\"lightning bolt\"", "Exactly the card Lightning Bolt (! means the exact name)"],
    ],
  },
  {
    id: "colors",
    title: "Colors and color identity",
    intro: <>
      <code>c:</code> (or <code>color:</code>) checks a card's colors; <code>id:</code> (or <code>identity:</code>) checks
      its color identity, which is what Commander deck building goes by. Use the letters <code>w u b r g</code>, color
      names, or a group's name: guilds like <code>azorius</code>, shards like <code>bant</code>, wedges
      like <code>abzan</code>. <code>c</code> means colorless and <code>m</code> multicolored. Compare with <code>&gt;</code>,
      <code>&lt;</code>, <code>&gt;=</code>, <code>&lt;=</code>, <code>=</code> and <code>!=</code>, or give a number of colors.
    </>,
    examples: [
      ["c:rg", "Cards that are red and green"],
      ["c=rg", "Exactly red and green, no other colors"],
      ["c>=uw -c:r", "At least white and blue, but not red"],
      ["id<=esper t:instant", "Instants you can play in an Esper (white-blue-black) Commander deck"],
      ["id:c t:land", "Lands with a colorless identity"],
      ["c=3", "Cards with exactly three colors"],
      ["c:m t:legendary t:creature", "Multicolored legendary creatures"],
    ],
  },
  {
    id: "types",
    title: "Card types",
    intro: <>
      <code>t:</code> (or <code>type:</code>) matches any part of the type line: supertypes like legendary and snow, card
      types like creature and instant, and subtypes like elf, equipment or saga. Part of a word is enough.
    </>,
    examples: [
      ["t:legendary t:elf", "Legendary Elves"],
      ["t:goblin -t:creature", "Goblin cards that aren't creatures"],
      ["t:equipment", "Equipment"],
      ["t:saga", "Sagas"],
    ],
  },
  {
    id: "text",
    title: "Rules text and keywords",
    intro: <>
      <code>o:</code> (or <code>oracle:</code>) searches a card's current rules text, so it finds the modern wording
      ("dies" rather than "is put into a graveyard"). Write <code>~</code> for the card's own
      name. <code>fo:</code> searches the full text including reminder text. <code>kw:</code> (or <code>keyword:</code>) finds
      a keyword ability like flying or cascade.
    </>,
    examples: [
      ["o:\"draw a card\" t:creature", "Creatures that draw a card"],
      ["o:\"~ enters tapped\"", "Cards that enter tapped"],
      ["kw:flying -t:creature", "Noncreature cards with flying"],
      ["kw:cascade", "Cards with cascade"],
      ["fo:\"can't be countered\"", "Mentions \"can't be countered\", reminder text included"],
    ],
  },
  {
    id: "mana",
    title: "Mana costs and mana value",
    intro: <>
      <code>m:</code> (or <code>mana:</code>) looks for symbols in the mana cost. Single symbols can be written plainly
      (<code>2WW</code>); hybrid and Phyrexian symbols need braces, like <code>{"{R/P}"}</code>. <code>mv</code> (or
      <code> cmc</code>) compares mana value as a number, and <code>mv:even</code> / <code>mv:odd</code> work too. <code>is:hybrid</code> and <code>is:phyrexian</code> find
      those symbols, <code>devotion:</code> counts devotion and <code>produces:</code> finds what mana a card makes.
    </>,
    examples: [
      ["m:2WW", "Costs with two generic and two white mana"],
      ["m:{R/P}", "Costs with a Phyrexian red symbol"],
      ["c:u mv=5", "Blue cards with mana value 5"],
      ["mv>=7 t:creature", "Creatures with mana value 7 or more"],
      ["produces=wu", "Cards that make white and blue mana"],
      ["devotion:{u/b}{u/b}{u/b}", "Permanents adding 3 to devotion to blue and black"],
    ],
  },
  {
    id: "stats",
    title: "Power, toughness and loyalty",
    intro: <>
      Compare <code>pow</code> (power), <code>tou</code> (toughness), <code>pt</code> (power plus toughness)
      and <code>loy</code> (starting loyalty) with a number or with each other.
    </>,
    examples: [
      ["pow>=8", "Power 8 or more"],
      ["pow>tou c:w t:creature", "White creatures with more power than toughness"],
      ["t:planeswalker loy=3", "Planeswalkers that start with 3 loyalty"],
      ["is:bear", "2-mana 2/2 creatures"],
    ],
  },
  {
    id: "kinds",
    title: "Kinds of card",
    intro: <>
      <code>is:</code> picks out kinds of card. A few useful ones: <code>is:permanent</code>, <code>is:spell</code>,
      <code> is:vanilla</code> (no rules text), <code>is:commander</code> (can be your commander), <code>is:companion</code>,
      <code> is:partner</code>, <code>is:reserved</code> (on the Reserved List), <code>is:gamechanger</code>, and
      double-faced cards with <code>is:dfc</code>, <code>is:mdfc</code>, <code>is:transform</code>, <code>is:split</code>,
      <code> is:flip</code> and <code>is:meld</code>. Land cycles have names too: <code>is:fetchland</code>, <code>is:shockland</code>,
      <code> is:dual</code>, <code>is:triome</code> and more. <code>not:</code> is the opposite of <code>is:</code>.
    </>,
    examples: [
      ["is:commander id:g", "Mono-green commanders"],
      ["is:mdfc t:land", "Modal double-faced cards with a land side"],
      ["is:fetchland", "Fetch lands"],
      ["is:reserved", "The Reserved List"],
      ["is:vanilla", "Creatures with no rules text"],
    ],
  },
  {
    id: "rarity",
    title: "Rarity",
    intro: <>
      <code>r:</code> (or <code>rarity:</code>) takes common, uncommon, rare, mythic, special or bonus, and can be compared.
      <code> in:rare</code> finds cards that have ever been printed at rare.
    </>,
    examples: [
      ["r:common t:creature f:pauper", "Common creatures legal in Pauper"],
      ["r>=r", "Rares and mythics"],
      ["in:rare -r:rare", "Printings below rare of cards that were once rare"],
    ],
  },
  {
    id: "sets",
    title: "Sets, blocks and collector numbers",
    intro: <>
      <code>e:</code> or <code>s:</code> (or <code>set:</code>) takes a set code, like <code>e:mh3</code>; every set's code
      is on the <Link to="/sets">list of sets</Link>. <code>cn:</code> is the collector number, <code>b:</code> a block,
      and <code>st:</code> the kind of product: core, expansion, masters, commander, draft_innovation, funny and so on.
      <code> in:</code> finds cards that have ever been printed in a set, and <code>is:booster</code> cards found in boosters.
    </>,
    examples: [
      ["e:mh3", "Modern Horizons 3"],
      ["e:mh3 cn<=50", "Its first 50 collector numbers"],
      ["in:lea in:m15", "Cards printed in both Alpha and Magic 2015"],
      ["st:commander is:commander", "Commanders from Commander products"],
      ["t:legendary -in:booster", "Legendary cards never printed in a booster"],
    ],
  },
  {
    id: "formats",
    title: "Format legality",
    intro: <>
      <code>f:</code> (or <code>format:</code>) finds cards legal in a format; <code>banned:</code> and <code>restricted:</code> find
      the opposite. Formats include standard, pioneer, modern, legacy, vintage, pauper, commander, oathbreaker, brawl,
      historic, timeless, alchemy, penny, duel, oldschool, premodern and predh. <code>edhrec</code> compares a card's EDHREC
      popularity rank, where 1 is the most played.
    </>,
    examples: [
      ["c:g t:creature f:pauper", "Green creatures legal in Pauper"],
      ["banned:modern", "Cards banned in Modern"],
      ["restricted:vintage", "The Vintage restricted list"],
      ["edhrec<=100", "The 100 most played Commander cards"],
    ],
  },
  {
    id: "prices",
    title: "Prices",
    intro: <>
      <code>usd</code>, <code>eur</code> and <code>tix</code> (Magic Online tickets) compare a printing's price.
      <code> cheapest:usd</code> keeps each card's cheapest printing.
    </>,
    examples: [
      ["usd<1 f:commander o:\"draw a card\"", "Commander card draw under $1"],
      ["usd>=50 t:land", "Lands worth $50 or more"],
      ["tix>15", "Cards over 15 tickets on Magic Online"],
    ],
  },
  {
    id: "art",
    title: "Artist, flavor text and watermark",
    intro: <>
      <code>a:</code> (or <code>artist:</code>) finds an artist, <code>ft:</code> (or <code>flavor:</code>) searches flavor
      text and <code>wm:</code> (or <code>watermark:</code>) a watermark. <code>new:art</code> finds printings with new
      illustrations.
    </>,
    examples: [
      ["a:\"john avon\" t:land", "Lands painted by John Avon"],
      ["ft:mishra", "Flavor text that mentions Mishra"],
      ["wm:orzhov", "Cards with the Orzhov watermark"],
    ],
  },
  {
    id: "printings",
    title: "Frames, finishes and printings",
    intro: <>
      <code>border:</code> (black, white, silver, borderless), <code>frame:</code> (1993, 1997, 2003, 2015, future, and
      effects like showcase or extendedart), <code>is:full</code> for full art, and <code>is:foil</code>,
      <code> is:nonfoil</code> and <code>is:etched</code> for finishes. <code>is:reprint</code>, <code>not:reprint</code> and
      <code> is:unique</code> look at a card's printing history; <code>prints</code> and <code>sets</code> count printings.
      <code> game:</code> is paper, mtgo or arena, and <code>is:digital</code> finds digital-only printings.
    </>,
    examples: [
      ["border:borderless t:planeswalker", "Borderless planeswalkers"],
      ["frame:showcase e:woe", "Showcase frames in Wilds of Eldraine"],
      ["e:ktk is:unique", "Khans of Tarkir cards never printed anywhere else"],
      ["sets>=20", "Cards printed in 20 or more sets"],
      ["-in:mtgo f:legacy", "Legacy-legal cards not on Magic Online"],
    ],
  },
  {
    id: "dates",
    title: "Release dates",
    intro: <>
      <code>year</code> and <code>date</code> compare release dates. A date is written yyyy-mm-dd, and a set code stands
      for that set's release date.
    </>,
    examples: [
      ["year<=1994", "Cards from 1994 and before"],
      ["date>=2023-01-01 t:dragon", "Dragons released since the start of 2023"],
      ["date>ori", "Printings from sets released after Magic Origins"],
    ],
  },
  {
    id: "tags",
    title: "What a card does and what's in its art",
    intro: <>
      <code>otag:</code> (or <code>function:</code>) uses tags describing what a card does, like removal, ramp, tutor or
      board-wipe. <code>art:</code> (or <code>atag:</code>) uses tags for what's in the illustration. The "What it does"
      filter on the search page builds these for you.
    </>,
    examples: [
      ["otag:removal c:w mv<=2", "Cheap white removal"],
      ["otag:ramp t:creature c:g", "Green creatures that ramp"],
      ["art:squirrel", "Art with a squirrel in it"],
    ],
  },
  {
    id: "logic",
    title: "Or, not and brackets",
    intro: <>
      Write <code>or</code> between terms to match either one, and put brackets round a group: <code>t:legendary (t:goblin or t:elf)</code>.
      A <code>-</code> in front of any term leaves out the cards that match it, including plain name words.
    </>,
    examples: [
      ["t:fish or t:bird", "Fish or Birds"],
      ["t:legendary (t:goblin or t:elf)", "Legendary Goblins or Elves"],
      ["-fire c:r t:instant", "Red instants without \"fire\" in the name"],
      ["not:reprint e:mh3", "New cards in Modern Horizons 3"],
    ],
  },
  {
    id: "regex",
    title: "Regular expressions",
    intro: <>
      Wrap a value in slashes to use a regular expression with <code>name:</code>, <code>t:</code>, <code>o:</code> and
      <code> ft:</code>. Things like <code>.*</code>, <code>(a|b)</code>, <code>[ab]</code>, <code>\d</code>, <code>\b</code>,
      <code> ^</code> and <code>$</code> all work; write a slash inside one as <code>\/</code>.
    </>,
    examples: [
      ["t:creature o:/^{T}:/", "Creatures with a plain tap ability"],
      ["name:/\\bizzet\\b/", "\"Izzet\" as a whole word in the name"],
      ["o:/deals \\d damage to any target/", "Burn that hits any target"],
    ],
  },
]

const searchLink = (q: string) => `/${searchUrl({ q, order: "name", dir: "auto", page: 1 })}`

export function meta() {
  return [
    { title: PAGE_TITLE },
    { name: "description", content: DESCRIPTION },
    { name: "theme-color", content: "#1a1515" },
    { property: "og:type", content: "article" },
    { property: "og:site_name", content: TITLE },
    { property: "og:url", content: `${SITE_URL}/syntax` },
    { property: "og:title", content: "MTG card search syntax guide" },
    { property: "og:description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/syntax` },
  ]
}

export default function Syntax() {
  return (
    <div>
      <SiteHeader />
      <main className={styles.page}>
        <aside className={styles.toc}>
          <h2 className={styles.label}>On this page</h2>
          <ul>
            {SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
          </ul>
        </aside>
        <article className={styles.body}>
          <h1 className={styles.title}>Search syntax guide</h1>
          <p className={styles.lead}>
            You don't need any of this: the filters on the <Link to="/">search page</Link> build searches for you.
            But if you'd rather type, or want something the filters don't cover, add a <strong>Custom query</strong> filter
            and write it in the syntax below. Every example is a link that runs it.
          </p>
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className={styles.section}>
              <h2>{s.title}</h2>
              <p>{s.intro}</p>
              <dl className={styles.examples}>
                {s.examples.map(([q, meaning]) => (
                  <div key={q}>
                    <dt><Link to={searchLink(q)}><code>{q}</code></Link></dt>
                    <dd>{meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </article>
      </main>
    </div>
  )
}
