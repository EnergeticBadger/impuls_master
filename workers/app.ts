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

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE
);

export default {
	async fetch(request, env, ctx) {
		if (new URL(request.url).pathname.startsWith(SCRYFALL_PREFIX)) {
			return handleScryfall(request, ctx);
		}
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},
} satisfies ExportedHandler<Env>;