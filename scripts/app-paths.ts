// Lets a script import the app's own modules with plain node: ~/… is app/… (as in tsconfig.json), and an
// import without an extension finds its .ts or .tsx. Use as node --import ./scripts/app-paths.ts <script>

import { registerHooks } from "node:module";

const app = new URL("../app/", import.meta.url);

registerHooks({
    resolve(specifier, context, nextResolve) {
        const spec = specifier.startsWith("~/") ? new URL(specifier.slice(2), app).href : specifier;
        try {
            return nextResolve(spec, context);
        } catch (error) {
            if (!/^(\.|\/|file:)/.test(spec) || /\.[cm]?[jt]sx?$/.test(spec)) throw error;
            for (const ext of [".ts", ".tsx"]) {
                try { return nextResolve(spec + ext, context); } catch { /* try the next */ }
            }
            throw error;
        }
    },
});
