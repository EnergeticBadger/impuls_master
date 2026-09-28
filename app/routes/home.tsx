import { Searchbar } from "~/Components/Searchbar/Searchbar";
import styles from './Home.module.css'
import { CardGrid } from "~/Components/CardGrid/CardGrid";
import { CompareDrawer } from "~/Components/Compare/CompareDrawer";
import { useSnapshot } from "valtio";
import { compare } from "~/Components/Context/compare";

const SITE_URL = "https://impulsecaster.cards";
const TITLE = "Impulse Caster";
const DESCRIPTION = "Fast, free Magic: The Gathering card search. Build searches with point-and-click filters, sort results and compare cards side by side. No syntax needed.";

export function meta() {
  return [
    { title: `${TITLE} | MTG Card Search` },
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
  ];
}

export default function Home() {
  const { cards, collapsed } = useSnapshot(compare)

  return (
    <div>
      <Searchbar/>
      <div className={styles.main_content} data-compare={cards.length ? (collapsed ? 'collapsed' : 'open') : undefined}>
        <CardGrid />
      </div>
      <CompareDrawer />
    </div>
  )
}
