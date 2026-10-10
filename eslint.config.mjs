// Next: https://nextjs.org/docs/app/api-reference/config/eslint
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "generated/**"]),
  {
    rules: {
      // dependencies.md trap 8: the Studio licence does not cover these outside Studio
      "no-restricted-imports": ["error", { paths: ["ag-grid-enterprise", "ag-charts-enterprise"] }],
    },
  },
]);
