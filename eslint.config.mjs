import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

// Modules that touch the filesystem, child processes, or the full OpenAPI
// validator. Client-facing code must never import them.
const serverOnlyImports = {
  paths: [
    { name: "fs", message: "Filesystem access belongs in server-only modules." },
    { name: "node:fs", message: "Filesystem access belongs in server-only modules." },
    { name: "fs/promises", message: "Filesystem access belongs in server-only modules." },
    { name: "node:fs/promises", message: "Filesystem access belongs in server-only modules." },
    { name: "child_process", message: "Process spawning belongs in server-only modules." },
    { name: "node:child_process", message: "Process spawning belongs in server-only modules." },
  ],
  patterns: [
    {
      group: ["@/lib/generation", "@/lib/generation/*", "@/lib/openapi/validate", "@/lib/openapi/validate.*"],
      message: "Server-only module: call it through a Route Handler instead.",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // Conflicts with the rule above: it suggests `!` instead of `as T`.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": "error",
    },
  },
  {
    // Server code may report operational problems, never content.
    files: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/app/**/page.tsx",
      // Library code that client components import, directly or transitively.
      "src/lib/archive/**/*.ts",
      "src/lib/guides/**/*.ts",
      "src/lib/openapi/**/*.ts",
      "src/lib/selection/**/*.ts",
      "src/lib/targets/**/*.ts",
      "src/lib/validation/**/*.ts",
      "src/lib/utils.ts",
    ],
    // Tests are not bundled and may read fixture files. The full OpenAPI
    // validator is itself a server-only module.
    ignores: ["**/*.test.{ts,tsx}", "src/lib/openapi/validate.ts"],
    rules: {
      "no-restricted-imports": ["error", serverOnlyImports],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
]);

export default eslintConfig;
