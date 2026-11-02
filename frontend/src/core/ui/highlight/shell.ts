// Shell, read as the shell reads it: words, quotes, variables, substitutions ($(…), `…`), operators, redirections and
// heredocs, each body's language guessed from the command it feeds. Each token [class, text, depth, a body's language]:
// depth, how deep in parentheses and substitutions -- the command's own steps are at 0. A word naming a command is
// "cmd", one starting with - a "flag", a name before = (an assignment) a "var".
import { langOfPath, words } from "./languages";

/** [class, text, depth, a heredoc body's language] */
export type ShToken = [cls: string, text: string, depth: number, lang?: string | null];

const SH_KW = words("if then else elif fi for do done while until case esac function select time ! { } [[");
const SH_NEXT = words("if then else elif do while until ! time {"); // a command's name comes after these
const SH_WRAP = words("sudo env exec nohup xargs command builtin nice watch"); // ...and after these, past their flags
const SH_WRAP_ARG: Record<string, Set<string>> = {
  env: words("-u -C -S"),
  sudo: words("-u -g -C -h -p -U"),
  nice: words("-n"),
  xargs: words("-I -n -P -L -s -d -E -a"),
  watch: words("-n"),
}; // flags taking a word
/** The highlighter's class of each of shLex's (the others are plain text). */
export const SH_CLASS: Record<string, string> = {
  cmd: "cmd",
  kw: "kw",
  op: "op",
  str: "str",
  var: "var",
  com: "com",
  flag: "flag",
};

/** A heredoc body's language: the interpreter reading it (python - <<EOF), else the file it is written to (cat > x.py <<EOF). */
export function hereLang(ws: string[], target: string | null): string | null {
  const name = (ws.find((w) => !/^\w+=/.test(w) && !w.startsWith("-") && !SH_WRAP.has(w.split("/").pop()!)) || "")
    .split("/")
    .pop()!;
  if (/^i?python[\d.]*$/.test(name)) return "python";
  if (/^(?:node|deno|bun)$/.test(name)) return "js";
  if (/^(?:sqlite3?|psql|mysql|duckdb)$/.test(name)) return "sql";
  if (/^(?:ba|z|k|da)?sh$/.test(name)) return "shell";
  return target ? langOfPath(target) : null;
}

/** the command being read: its words, and the file it writes to */
interface At {
  words: string[];
  target: string | null;
}

export function shLex(src: string): ShToken[] {
  const out: ShToken[] = [],
    pending: { delim: string; strip: boolean; at: At }[] = []; // pending: the heredocs started on this line, their bodies after it
  let i = 0,
    cmd = true,
    redir = false,
    wrapped = "",
    arg = false,
    at: At = { words: [], target: null }; // at: the command being read; wrapped: the wrapper before it
  const push = (cls: string, text: string, depth: number, lang?: string | null) => {
    if (text) out.push([cls, text, depth, lang]);
  };
  const take = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(src);
    if (m && m[0]) i += m[0].length;
    return m && m[0] ? m : null;
  };
  const next = () => {
    cmd = true;
    redir = arg = false;
    wrapped = "";
    at = { words: [], target: null };
  };
  const bodies = (depth: number) => {
    while (pending.length) {
      const h = pending.shift()!,
        lang = hereLang(h.at.words, h.at.target);
      let body = "";
      for (;;) {
        if (i >= src.length) {
          push("here", body, depth, lang); // its end clipped off
          return;
        }
        const j = src.indexOf("\n", i),
          end = j < 0 ? src.length : j,
          line = src.slice(i, end);
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) {
          push("here", body, depth, lang);
          push("op", line, depth);
          i = pending.length ? Math.min(src.length, end + 1) : end; // the next body starts on the next line
          break;
        }
        body += line + (j < 0 ? "" : "\n");
        i = j < 0 ? src.length : j + 1;
      }
    }
  };
  // inside $( … ), ( … ) or ` … `: commands of their own, up to the close
  const sub = (depth: number, close: string) => {
    const keep: [At, boolean, string] = [at, redir, wrapped];
    next();
    lex(depth, close);
    if (src[i] === close) {
      push("op", close, depth - 1);
      i++;
    }
    [at, redir, wrapped] = keep;
    cmd = false;
  };
  const dollar = (depth: number) => {
    const from = i;
    if (src.startsWith("$((", i)) {
      const j = src.indexOf("))", i + 3);
      i = j < 0 ? src.length : j + 2;
      push("var", src.slice(from, i), depth);
      return;
    }
    if (src[i + 1] === "(") {
      i += 2;
      push("op", "$(", depth);
      sub(depth + 1, ")");
      return;
    }
    if (src[i + 1] === "{") {
      const j = src.indexOf("}", i + 2);
      i = j < 0 ? src.length : j + 1;
      push("var", src.slice(from, i), depth);
      return;
    }
    if (take(/\$(?:[A-Za-z_]\w*|[0-9@*#?$!-])/y)) push("var", src.slice(from, i), depth);
    else {
      i++;
      push("w", "$", depth);
    }
  };
  const tick = (depth: number) => {
    push("op", "`", depth);
    i++;
    sub(depth + 1, "`");
  };
  const dq = (depth: number) => {
    // "…": its variables and substitutions read inside it
    let from = i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "$" && /[({\w@*#?$!]/.test(src[i + 1] || "")) {
        push("str", src.slice(from, i), depth);
        dollar(depth);
        from = i;
        continue;
      }
      if (src[i] === "`") {
        push("str", src.slice(from, i), depth);
        tick(depth);
        from = i;
        continue;
      }
      i++;
    }
    i = Math.min(src.length, i + 1);
    push("str", src.slice(from, i), depth);
  };
  const flag = (k: number, head: ShToken, depth: number) => {
    const e = head[1].indexOf("=");
    if (e < 0) head[0] = "flag";
    else out.splice(k, 1, ["flag", head[1].slice(0, e), depth], ["w", head[1].slice(e), depth]);
  };
  const word = (depth: number, close: string | null) => {
    const start = out.length,
      begin = i,
      wasCmd = cmd,
      target = redir;
    cmd = redir = false;
    while (i < src.length) {
      const c = src[i],
        from = i;
      if (" \t\n|&;()<>".includes(c) || (c === "`" && close === "`")) break;
      if (c === "'") {
        const j = src.indexOf("'", i + 1);
        i = j < 0 ? src.length : j + 1;
        push("str", src.slice(from, i), depth);
      } else if (c === "$" && src[i + 1] === "'") {
        take(/\$'(?:[^'\\]|\\[\s\S])*'?/y);
        push("str", src.slice(from, i), depth);
      } else if (c === '"') dq(depth);
      else if (c === "$") dollar(depth);
      else if (c === "`") tick(depth);
      else if (c === "\\") {
        i = Math.min(src.length, i + 2);
        push("w", src.slice(from, i), depth);
      } else {
        take(/[^ \t\n|&;()<>'"$`\\]+/y);
        push("w", src.slice(from, i), depth);
      }
    }
    if (i === begin) {
      i++;
      push("w", src[begin], depth);
    }
    const raw = src.slice(begin, i),
      head: ShToken | undefined = out[start];
    if (head && head[0] === "w" && wasCmd) {
      if (out.length === start + 1 && SH_KW.has(raw)) {
        head[0] = "kw";
        cmd = SH_NEXT.has(raw);
        return;
      }
      const name = /^[A-Za-z_]\w*(?=\+?=)/.exec(head[1]);
      if (name) {
        const parts: ShToken[] = [
          ["var", name[0], depth],
          ["w", head[1].slice(name[0].length), depth],
        ];
        out.splice(start, 1, ...parts.filter((t) => t[1]));
        cmd = true;
        return;
      }
      if (arg) {
        // a wrapper's flag's word (env -u NAME)
        arg = false;
        cmd = true;
        return;
      }
      if (wrapped && head[1].startsWith("-")) {
        flag(start, head, depth);
        arg = !!(SH_WRAP_ARG[wrapped] && SH_WRAP_ARG[wrapped].has(raw));
        cmd = true;
        return;
      }
      head[0] = "cmd";
      at.words.push(raw);
      wrapped = SH_WRAP.has(raw.split("/").pop()!) ? raw.split("/").pop()! : "";
      cmd = !!wrapped;
      return;
    }
    if (head && head[0] === "w" && head[1].startsWith("-")) flag(start, head, depth);
    if (target || (at.words[0] && at.words[0].split("/").pop() === "tee" && !raw.startsWith("-"))) at.target = raw;
    at.words.push(raw);
  };
  const lex = (depth: number, close: string | null) => {
    while (i < src.length) {
      const c = src[i],
        from = i;
      let m;
      if (close && c === close) return;
      if (c === "\n") {
        i++;
        push("nl", "\n", depth);
        bodies(depth);
        next();
        continue;
      }
      if (c === " " || c === "\t") {
        take(/[ \t]+/y);
        push("ws", src.slice(from, i), depth);
        continue;
      }
      if (c === "\\" && src[i + 1] === "\n") {
        i += 2;
        push("ws", "\\\n", depth);
        continue;
      }
      if (c === "#") {
        take(/#[^\n]*/y);
        push("com", src.slice(from, i), depth);
        continue;
      }
      if ((m = take(/<<(-?)[ \t]*\\?(['"]?)([A-Za-z_][\w.-]*)\2/y))) {
        push("op", m[0], depth);
        pending.push({ delim: m[3], strip: !!m[1], at });
        continue;
      }
      if (take(/\d*(?:<<<|&>>|&>|>>|>&|<&|>\||<>|>|<)(?:&?\d+-?|&-)?/y)) {
        const r = src.slice(from, i);
        push("op", r, depth);
        redir = !/&(?:\d+-?|-)$/.test(r);
        continue;
      }
      if (take(/&&|\|\||;;&?|;&|\|&|[|;&]/y)) {
        push("op", src.slice(from, i), depth);
        next();
        continue;
      }
      if (c === "(") {
        i++;
        push("op", "(", depth);
        sub(depth + 1, ")");
        continue;
      }
      if (c === ")" || c === "`") {
        // with nothing open
        i++;
        push("op", c, depth);
        continue;
      }
      word(depth, close);
    }
  };
  lex(0, null);
  return out;
}
