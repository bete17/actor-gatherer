// The dashboard's front end (ag_dashboard/DESIGN.md). Its build goes to ag_dashboard/static/, which the server serves
// and the Python package ships; `vite` alone serves it in development, the dashboard's own routes passed through to
// the dashboard at AG_DASHBOARD_URL (default: the one ag runs, http://127.0.0.1:4200).
import { defineConfig } from "vitest/config";

const dashboard = process.env.AG_DASHBOARD_URL || "http://127.0.0.1:4200";

export default defineConfig({
  build: { outDir: "../ag_dashboard/static", emptyOutDir: true },
  server: {
    proxy: Object.fromEntries(
      ["/api", "/avatars", "/vendor", "/views", "/preview", "/browser", "/docwriter"].map((p) => [p, dashboard]),
    ),
  },
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "jsdom", passWithNoTests: true },
});
