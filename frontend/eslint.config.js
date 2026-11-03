// Lint for the dashboard's front end. The import rules between folders (ag_dashboard/DESIGN.md, "Rules") come in
// with the code they govern (step A4).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }] },
  },
);
