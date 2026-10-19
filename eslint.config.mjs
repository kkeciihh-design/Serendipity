import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([".next/**", ".next-*/**", "node_modules/**", "test-data/**", "output/**", "next-env.d.ts"]),
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        Image: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
]);
