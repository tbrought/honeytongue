// Syntax highlighting for the docs site's code blocks, done at build time as static spans, so the page needs no
// script, library, or inline style for it. Run by `npm run build:demo`; test/highlight.test.js fails if
// docs/index.html is out of date.
//
// It reads each <pre><code> block's text (dropping spans from an earlier run), tokenizes it, and writes it back,
// so running it twice gives the same page. Classes, styled in docs/style.css: k keyword or tag, s string,
// n number, literal, or flag, f function, command, or attribute, c comment. Strings holding story markup mark
// @[name] and #[item] as the demo shows them. Everything is written back escaped, so code can't become markup.

const KEYWORDS = new Set(("await async break case catch class const continue default delete do else export extends " +
  "finally for from function if import in instanceof let new of return static super switch this throw try typeof var " +
  "void while yield").split(" "));
const LITERALS = new Set(["true", "false", "null", "undefined", "Infinity", "NaN"]);
// A shell command, even inside a JavaScript block (like setting an environment variable).
const SHELL_LINE = /^(\s*)(npm|npx|node|git|cd|export [A-Z_]+=|\$env:)/;

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
const span = (cls, text) => `<span class="${cls}">${escape(text)}</span>`;

/** A string, with any story markup inside it marked as a character or an item. */
function stringToken(text) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/([@#])\[([^\]\n]+)\]/g)) {
    out += escape(text.slice(last, m.index)) + span(m[1] === "@" ? "part-character" : "part-item", m[0]);
    last = m.index + m[0].length;
  }
  return `<span class="s">${out}${escape(text.slice(last))}</span>`;
}

function js(text) {
  const token = /(\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|([\s\S])/g;
  let out = "";
  let prev = "";
  for (const m of text.matchAll(token)) {
    const [tok, comment, string, number, word] = m;
    if (comment) out += span("c", tok);
    else if (string) out += stringToken(tok);
    else if (number) out += span("n", tok);
    else if (word) {
      const after = text.slice(m.index + tok.length);
      if (KEYWORDS.has(word) && prev !== ".") out += span("k", tok);
      else if (LITERALS.has(word)) out += span("n", tok);
      else if (/^\s*\(/.test(after) || /^\s*:\s*(async\s*)?\(/.test(after)) out += span("f", tok); // a call, or a method-like option
      else out += escape(tok);
    } else out += escape(tok);
    if (!/\s/.test(tok)) prev = tok;
  }
  return out;
}

function shell(line) {
  const token = /((?:^|(?<=\s))#[^\n]*)|("(?:\\.|[^"\\\n])*")|(^\s*(?:\$env:\w+|export|npm|npx|node|git|cd)\b)|((?<=\s)--?[\w-]+)|([\s\S])/g;
  let out = "";
  for (const m of line.matchAll(token)) {
    const [tok, comment, string, command, flag] = m;
    if (comment) out += span("c", tok);
    else if (string) out += span("s", tok);
    else if (command) out += tok.replace(/\S+/, (w) => span("f", w));
    else if (flag) out += span("n", tok);
    else out += escape(tok);
  }
  return out;
}

function html(text) {
  // A module script's body is JavaScript; the rest is tags and attributes.
  const pieces = text.split(/(<script type="module">\n?)([\s\S]*?)(?=<\/script>)/);
  let out = "";
  pieces.forEach((piece, i) => {
    if (i % 3 === 2) { out += js(piece); return; }
    for (const m of (piece ?? "").matchAll(/(<\/?[\w-]+)|([\w-]+(?==))|("[^"]*")|([\s\S])/g)) {
      const [tok, tag, attribute, string] = m;
      out += tag ? span("k", tok) : attribute ? span("f", tok) : string ? span("s", tok) : escape(tok);
    }
  });
  return out;
}

/** Which language a block is in: html, shell (every line a command or comment), json, or js. */
export function languageOf(text) {
  if (/^\s*</.test(text)) return "html";
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.every((l) => SHELL_LINE.test(l) || /^\s*#/.test(l))) return "shell";
  if (/^\s*"[\w-]+":/.test(text)) return "json";
  return "js";
}

const LABELS = { js: "JavaScript", shell: "Shell", html: "HTML", json: "JSON" };

/** One block's text as highlighted markup, and its language. */
export function highlightBlock(text) {
  const lang = languageOf(text);
  const markup = lang === "html" ? html(text)
    : lang === "shell" ? text.split("\n").map(shell).join("\n")
    : text.split("\n").map((line) => (SHELL_LINE.test(line) ? shell(line) : js(line))).join("\n");
  return { lang, markup };
}

/** Highlight every <pre><code> block in a page. Earlier highlighting is removed first, so it's idempotent. */
export function highlightPage(page) {
  return page.replace(/<pre(?: data-lang="[^"]*")?><code>([\s\S]*?)<\/code><\/pre>/g, (_, inner) => {
    const text = unescape(inner.replace(/<\/?span[^>]*>/g, ""));
    const { lang, markup } = highlightBlock(text);
    // Longer blocks say what language they're in; a one-line command speaks for itself.
    return text.includes("\n") ? `<pre data-lang="${LABELS[lang]}"><code>${markup}</code></pre>` : `<pre><code>${markup}</code></pre>`;
  });
}

/** The pages it highlights. */
export const HIGHLIGHTED = ["docs/index.html"];
