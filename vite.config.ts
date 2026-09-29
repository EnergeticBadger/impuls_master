import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // a new id for every build; saved card pages are keyed by it (workers/app.ts), so a rebuild never serves
  // pages that point at the previous build's scripts, even locally where the deploy version doesn't change
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  plugins: [reactRouter(), cloudflare({
    viteEnvironment: {
      name: "ssr"
    }
  })],
  resolve: {
    tsconfigPaths: true,
  },
});