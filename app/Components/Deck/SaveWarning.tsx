import { useSnapshot } from "valtio";
import styles from "./SaveWarning.module.css";
import { deckSave } from "~/Components/Context/decks";

// shown while the last write of the decks to localStorage failed
export function SaveWarning() {
  const { error } = useSnapshot(deckSave)
  if (!error) return null
  return <div role="alert" className={styles.warning}>{error}</div>
}
