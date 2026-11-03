// Text put into HTML as text: its markup characters escaped. The page's renderers build HTML strings (code coloured,
// markdown), each piece of text through this.
const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (t: string): string => t.replace(/[&<>"']/g, (c) => ENTITIES[c]);
