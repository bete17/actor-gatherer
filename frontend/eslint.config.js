// Lint for the dashboard's front end. The import rules between folders (ag_dashboard/DESIGN.md, "Rules") come in
// with the code they govern (step A4).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // src/legacy/: page.html's script, line for line as it was (one scope, its sections joined by vite-plugin-legacy.ts),
  // kept so until each view is rewritten: not linted.
  { ignores: ["node_modules/", "test-results/", "playwright-report/", "src/legacy/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }] },
  },
);
