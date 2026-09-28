import { Searchbar } from "~/Components/Searchbar/Searchbar";
import styles from './Home.module.css'
import { CardGrid } from "~/Components/CardGrid/CardGrid";
import { CompareDrawer } from "~/Components/Compare/CompareDrawer";
import { useSnapshot } from "valtio";
import { compare } from "~/Components/Context/compare";

export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
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
