// The dashboard's own routes, as the page calls them: JSON in, JSON out, an error said in words.

/** GET `path`'s JSON. */
export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

/** POST `body` as JSON to `path`: its JSON answer, or an Error with the server's `error`. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const got = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((got as { error?: string }).error || `${path}: ${r.status}`);
  return got as T;
}
