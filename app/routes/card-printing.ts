// /card/<set>/<number>/<name>, the old address of a single printing: now that printing on the card's one page
import { redirect } from "react-router";
import type { Route } from "./+types/card-printing";

export function loader({ params }: Route.LoaderArgs) {
    throw redirect(`/card/${params.slug}?print=${encodeURIComponent(`${params.set}-${params.number}`)}`, 301)
}
