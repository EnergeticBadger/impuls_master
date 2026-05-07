import { Searchbar } from "~/Components/Searchbar/Searchbar";
import styles from './Home.module.css'
import { CardGrid } from "~/Components/CardGrid/CardGrid";

export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home() {

  
  return (
    <div>
      <Searchbar/>
      <div className={styles.main_content}>
        <CardGrid />
      </div>
    </div>
  )
}
