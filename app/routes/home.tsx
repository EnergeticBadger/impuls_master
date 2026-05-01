import { HeaderText } from "~/Components/HeaderText/HeaderText";
import { Searchbar } from "~/Components/Searchbar/Searchbar";
import styles from './Home.module.css'
export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home() {
  return (
    <div>
      <Searchbar />
      <div className={styles.main_content}>
        <HeaderText header="New React App" />
      </div>
    </div>
  )
}
