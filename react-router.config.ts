import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // every route ships with the first page, so the browser never calls /__manifest. Each of those calls is a
  // Worker request, and crawlers browsing card pages made 56k of them in a day (16 Oct), past the free plan's limit
  routeDiscovery: { mode: "initial" },

  future: {
    v8_viteEnvironmentApi: true
  }
} satisfies Config;