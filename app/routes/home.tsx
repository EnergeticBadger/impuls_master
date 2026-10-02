import { Searchbar } from "~/Components/Searchbar/Searchbar";
import styles from './Home.module.css'
import { CardGrid } from "~/Components/CardGrid/CardGrid";
import { CompareDrawer } from "~/Components/Compare/CompareDrawer";
import { useSnapshot } from "valtio";
import { compare } from "~/Components/Context/compare";
import type { Route } from "./+types/home";

const SITE_URL = "https://impulsecaster.cards";
const TITLE = "Impulse Caster";
const DESCRIPTION = "Fast, free Magic: The Gathering card search. Build searches with point-and-click filters, sort results and compare cards side by side. No syntax needed.";

export function meta({ location }: Route.MetaArgs) {
  // a search's own title, so it reads right in the history list and a bookmark
  const q = new URLSearchParams(location.search).get('q')?.trim()
  return [
    { title: q ? `${q} | ${TITLE}` : `${TITLE} | MTG Card Search` },
    { name: "description", content: DESCRIPTION },
    { name: "theme-color", content: "#1a1515" },
    // og:image and og:url must be absolute or link previews won't pick them up
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: TITLE },
    { property: "og:url", content: `${SITE_URL}/` },
    { property: "og:title", content: `${TITLE} | MTG Card Search` },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:image", content: `${SITE_URL}/og-image.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Impulse Caster logo: a red card with a gold lightning bolt, lifted off a second card" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: `${TITLE} | MTG Card Search` },
    { name: "twitter:description", content: DESCRIPTION },
    { name: "twitter:image", content: `${SITE_URL}/og-image.png` },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/` },
    { "script:ld+json": STRUCTURED_DATA },
  ];
}

// schema.org data so search engines show the site's name as "Impulse Caster" and use its logo.
// (There's no rich result for a search site's home page; the card pages carry the product data.)
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: TITLE,
      url: `${SITE_URL}/`,
      description: DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: TITLE,
      url: `${SITE_URL}/`,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/apple-touch-icon.png`, width: 180, height: 180 },
    },
  ],
};

export default function Home() {
  const { cards, collapsed } = useSnapshot(compare)

  return (
    <div>
      <Searchbar/>
      <div className={styles.main_content} data-card-area data-compare={cards.length ? (collapsed ? 'collapsed' : 'open') : undefined}>
        <CardGrid />
      </div>
      <CompareDrawer />
    </div>
  )
}
