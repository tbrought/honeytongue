// Story markup: optional inline marks in the text players read, so any interface can style a story its own way.
//
//   @[Harry Goatleaf]   a character
//   #[toy horse]        an item, or anything the player can interact with
//   "..."               speech, found automatically (straight or curly double quotes)
//   \@[  \#[            a literal @[ or #[
//
// This module only says what each piece of text means. How it looks is up to whoever renders it: the web demo
// and the terminal player are two examples. Nothing here is sent to Jev: the engine strips markup from everything
// it sends (see stripMarkupDeep), so Jev judges the same plain text with or without it.

const OPEN = { "@": "character", "#": "item" };

/**
 * Split text into markup segments: { kind: "text" | "character" | "item", text }. Escapes become literal text.
 * An opener with no closing bracket on the same line is left as literal text; validateStory reports it.
 */
function segments(input) {
  const text = String(input ?? "");
  const out = [];
  let buf = "";
  const flush = () => { if (buf) out.push({ kind: "text", text: buf }); buf = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && OPEN[text[i + 1]] && text[i + 2] === "[") { buf += text[i + 1] + "["; i += 2; continue; }
    if (OPEN[c] && text[i + 1] === "[") {
      const end = text.indexOf("]", i + 2);
      const newline = text.indexOf("\n", i + 2);
      if (end > i + 2 && (newline === -1 || end < newline)) {
        flush();
        out.push({ kind: OPEN[c], text: text.slice(i + 2, end) });
        i = end;
        continue;
      }
    }
    buf += c;
  }
  flush();
  return out;
}

/** The text with markup removed and escapes resolved: what players read in plain text, and what Jev sees. */
export function stripMarkup(text) {
  return segments(text).map((s) => s.text).join("");
}

/** Strip markup from every string in a value (objects and arrays are copied). The engine's one point before Jev. */
export function stripMarkupDeep(value) {
  if (typeof value === "string") return stripMarkup(value);
  if (Array.isArray(value)) return value.map(stripMarkupDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripMarkupDeep(v)]));
  return value;
}

/** Whether text contains anything markup would change: an opener (even unclosed) or an escape. */
export function hasMarkup(text) {
  return /[@#]\[/.test(String(text ?? ""));
}

/** Mistakes in a piece of story text's markup, as readable sentences (empty when it's fine). */
export function markupProblems(text) {
  const problems = [];
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && OPEN[s[i + 1]] && s[i + 2] === "[") { i += 2; continue; }
    if (!(OPEN[s[i]] && s[i + 1] === "[")) continue;
    const mark = `${s[i]}[`;
    const end = s.indexOf("]", i + 2);
    const newline = s.indexOf("\n", i + 2);
    if (end === -1 || (newline !== -1 && newline < end)) {
      problems.push(`${mark} isn't closed with ] (write \\${mark} for a literal ${mark})`);
      continue;
    }
    const inner = s.slice(i + 2, end);
    if (!inner.trim()) problems.push(`${mark}] is empty`);
    else if (/[@#]\[/.test(inner)) problems.push(`markup can't be nested, as in ${mark}${inner}]`);
    i = end;
  }
  return problems;
}

/**
 * Where speech is in a paragraph, as [start, end) ranges over its plain text, quotes included. Only double quotes
 * mark speech: straight ("...") or curly (“...”). Apostrophes and single quotes never do. When the quotes don't
 * pair up cleanly (an odd number, curly quotes out of order, or straight and curly mixed), nothing is marked:
 * better unstyled than styled wrongly.
 */
function speechRanges(quotes) {
  const straight = quotes.filter((q) => q.char === '"');
  const curly = quotes.filter((q) => q.char !== '"');
  if (straight.length && curly.length) return [];
  if (straight.length % 2 || curly.length % 2) return [];
  const ranges = [];
  for (let i = 0; i < quotes.length; i += 2) {
    const [a, b] = [quotes[i], quotes[i + 1]];
    if (curly.length && (a.char !== "“" || b.char !== "”")) return [];
    ranges.push([a.at, b.at + 1]);
  }
  return ranges;
}

/**
 * A paragraph of story text as meaningful parts: { kind: "text" | "speech" | "character" | "item", text }, in order.
 * A character or item named inside speech also has `inSpeech: true`. Joining every part's text gives stripMarkup(text).
 */
export function parseMarkup(text) {
  const segs = segments(text);
  // Quotes inside a name or item don't count: only quotes in the running text mark speech.
  const quotes = [];
  let at = 0;
  for (const seg of segs) {
    if (seg.kind === "text") for (let j = 0; j < seg.text.length; j++) if ('"“”'.includes(seg.text[j])) quotes.push({ char: seg.text[j], at: at + j });
    at += seg.text.length;
  }
  const ranges = speechRanges(quotes);
  const inSpeech = (pos) => ranges.some(([a, b]) => pos >= a && pos < b);

  const parts = [];
  const push = (part) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === part.kind && part.kind !== "character" && part.kind !== "item") last.text += part.text;
    else parts.push(part);
  };
  at = 0;
  for (const seg of segs) {
    if (seg.kind !== "text") {
      push(inSpeech(at) ? { kind: seg.kind, text: seg.text, inSpeech: true } : { kind: seg.kind, text: seg.text });
    } else {
      // Split running text where speech starts and ends.
      let start = 0;
      for (let j = 1; j <= seg.text.length; j++) {
        if (j === seg.text.length || inSpeech(at + j) !== inSpeech(at + start)) {
          push({ kind: inSpeech(at + start) ? "speech" : "text", text: seg.text.slice(start, j) });
          start = j;
        }
      }
    }
    at += seg.text.length;
  }
  return parts.filter((p) => p.text);
}
