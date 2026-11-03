// Code, coloured: the page's own highlighter (languages.ts, highlight.ts), its shell reader (shell.ts) and how it lays a
// command out (command.ts), a command's output in its terminal's colours (output.ts), and a fenced block (fence.ts).
export { guessWeb, hlLang, langOfPath, type Token } from "./languages";
export { shLex, type ShToken } from "./shell";
export { hlInside, hlLines, hlPart, hlTokens, quoteRole, tokenLines } from "./highlight";
export { shellHtml, tildePath } from "./command";
export { ansiHtml, outputHtml } from "./output";
export { codeClick, codeFence, codeFolded, fence, foldCode, foldKept } from "./fence";
