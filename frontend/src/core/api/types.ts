// What the dashboard's routes answer, as far as the new code reads it. Written by hand until they are generated from
// the server's schema (ag_dashboard/DESIGN.md, B2).

/** /api/home, and the stream's `home`: the gatherers and their actors, and what this dashboard runs. */
export interface Home {
  home: string;
  now: number;
  gatherers: { name: string; agents: unknown[] }[];
  /** Browsers can be started here; `browser_profile` "mine": they run in the user's own Chrome. */
  browser?: boolean;
  browser_profile?: string;
}

/** /api/settings (settings.py's `read`): ag's config.toml as the panel shows it. */
export interface Settings {
  path: string;
  exists: boolean;
  error?: string | null;
  version: string;
  text: string;
  llm: { model: string; api_base: string; key_env: string };
  env?: Record<string, string>;
  policies: { available: string[]; default: string };
  pollers: { available: string[]; default: string[] };
  cli: { gatherer: string; harnesses: Record<string, { command?: string[]; port?: number; upstream?: string }> };
  /** After setting the model: what it runs on, in words. */
  said?: string;
}
