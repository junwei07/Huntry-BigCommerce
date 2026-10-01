import path from "node:path";
import { defineConfig } from "vitest/config";

// Vite/Vitest does not read tsconfig.json's `paths` automatically — this
// mirrors that one `@/*` -> `./src/*` alias manually rather than adding a
// vite-tsconfig-paths dependency for a single mapping.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Plain Node, not jsdom/happy-dom — these are server-side unit/
    // integration tests (credentials store, session JWTs, install flow),
    // and node:sqlite's DatabaseSync needs a real Node environment.
    environment: "node",
    // Test files live in tests/, mirroring src/'s structure, not co-located
    // next to the source they cover — this makes that convention structural
    // rather than relying on vitest's own default any-directory glob.
    include: ["tests/**/*.test.ts"],
  },
});
