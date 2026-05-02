import { Searchbar } from "~/Components/Searchbar/Searchbar";
import styles from './Home.module.css'
import { CardGrid } from "~/Components/CardGrid/CardGrid";
import { useState } from "react";
import type { ImageUris } from "~/types";
export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home() {

  const [cards, setCards] = useState<ImageUris[]>([])

  return (
    <div>
      <Searchbar setCards={setCards} />
      <div className={styles.main_content}>
          <CardGrid cards={cards} />
      </div>
    </div>
  )
}
