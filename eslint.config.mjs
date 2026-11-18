import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals, ...nextTs,
  globalIgnores(["docs/**", ".staging-migrations/**", ".vercel/**", ".open-next/**", ".wrangler/**", ".cloudflare-bundle/**", ".next/**", "node_modules/**", "coverage/**", "test-results/**", "playwright-report/**", ".agents/**", ".codex/**", ".impeccable/**", ".taste-skill/**", "next-env.d.ts"])
]);
