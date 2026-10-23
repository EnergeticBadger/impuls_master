import styles from "./PcBuilder.module.css";
import { SITE_URL } from "~/lib/carddata";
import { SiteHeader } from "~/Components/Site/SiteHeader";

const TITLE = "Impulse Caster";

// Quoted Tech's PC configurator in its partner mode: our code turns Add to cart into a quote PDF and takes their
// branding off. quoted.tech only lets impulsecaster.cards frame it with this code, so a local dev server shows a
// refused frame; try it on the deployed site.
const EMBED_CODE = "2DwblYrDcDamunj75kFumcls";
const CONFIGURATOR_URL = `https://quoted.tech/desktops/gaming/configurator?embed=${EMBED_CODE}&lang=fr`;

export function meta() {
  return [
    { title: `Build a PC | ${TITLE}` },
    // a test of the embed for now, so it stays out of search results
    { name: "robots", content: "noindex" },
    { name: "theme-color", content: "#1a1515" },
    { tagName: "link", rel: "canonical", href: `${SITE_URL}/pc-builder` },
  ];
}

export default function PcBuilder() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <iframe
        className={styles.frame}
        src={CONFIGURATOR_URL}
        title="PC configurator"
        // the configurator copies share links
        allow="clipboard-write"
      />
    </div>
  );
}
