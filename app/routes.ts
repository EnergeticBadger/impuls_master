import { type RouteConfig, index, route } from "@react-router/dev/routes";

// /sitemap.xml and /sitemaps/* are static files made with the card data (scripts/card-data.ts)
export default [
  index("routes/home.tsx"),
  route("card/:slug", "routes/card.tsx"),
  route("card/:set/:number/:slug", "routes/card-printing.ts"),
  route("sets", "routes/sets.tsx"),
  route("sets/:code", "routes/set.tsx"),
  route("syntax", "routes/syntax.tsx"),
] satisfies RouteConfig;
