import { createRequestHandler } from "react-router";
import { SCRYFALL_PREFIX, handleScryfall } from "./scryfall";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

declare const __BUILD_ID__: string;

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE
);

// Card and set pages (and the data behind them, for moving between pages in the browser) are kept for a day in each
// Cloudflare location, so only the first visit there spends the Worker's CPU rendering the page. The key
// includes the deploy's version and the build's id: a new deploy (daily, with new card data) mustn't serve pages
// built by the old one, whose scripts are gone.
const CACHED_PAGES = /^\/(card\/|sets(\/|\.data$|$))/;
const EDGE_TTL = 60 * 60 * 24;
// what the browser was told, kept alongside the day-long copy
const BROWSER_CACHE = "X-Browser-Cache-Control";

async function cachedPage(request: Request, env: Env, ctx: ExecutionContext, render: () => Promise<Response>) {
	const url = new URL(request.url);
	url.searchParams.set("__version", `${env.CF_VERSION_METADATA.id}-${__BUILD_ID__}`);
	const key = new Request(url.toString());
	const cache = await caches.open("pages");

	const hit = await cache.match(key);
	if (hit) {
		const res = new Response(hit.body, hit);
		res.headers.set("Cache-Control", hit.headers.get(BROWSER_CACHE) ?? "no-store");
		res.headers.delete(BROWSER_CACHE);
		res.headers.set("X-Cache", "HIT");
		return res;
	}

	const res = await render();
	const browser = res.headers.get("Cache-Control");
	// only whole pages: one missing its rulings says no-store, so the next visit tries again
	if (res.status === 200 && browser?.startsWith("public")) {
		const copy = new Response(res.clone().body, res);
		copy.headers.set(BROWSER_CACHE, browser);
		copy.headers.set("Cache-Control", `public, max-age=${EDGE_TTL}`);
		ctx.waitUntil(cache.put(key, copy));
	}
	return res;
}

export default {
	async fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith(SCRYFALL_PREFIX)) {
			return handleScryfall(request, ctx);
		}
		const render = () => requestHandler(request, { cloudflare: { env, ctx } });
		if (request.method === "GET" && CACHED_PAGES.test(pathname)) return cachedPage(request, env, ctx, render);
		return render();
	},
} satisfies ExportedHandler<Env>;
