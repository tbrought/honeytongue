// The "Try it" links in the docs site's "Same words, different people" grid. Each opens the playground with that
// column's preset character loaded and that row's line ready to send, using the playground's share links (naming
// the preset rather than copying it, so the link stays short and opens the preset as it is now).
// npm run build:demo writes them from evals/showcase.json; test/showcase.test.js fails if they're stale.
import { readFileSync } from "node:fs";
import { encodeShare } from "../docs/playground/designer.js";

const suite = JSON.parse(readFileSync(new URL("../evals/showcase.json", import.meta.url), "utf8"));
const characters = JSON.parse(readFileSync(new URL("../stories/characters.json", import.meta.url), "utf8"));
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The playground address, relative to the docs site's home page, that tries this line on this preset. */
export const tryHref = (preset, line) => `playground/${encodeShare({ preset, line })}`;

/** The home page with every grid cell's "Try it" link written (or rewritten) from the showcase suite. */
export function linkShowcase(html) {
  const start = html.indexOf('<table class="grid">');
  const end = html.indexOf("</table>", start);
  if (start < 0 || end < 0) throw new Error('docs/index.html has no <table class="grid">');
  let table = html.slice(start, end);
  const columns = [...table.matchAll(/data-character="([^"]+)"/g)].map((m) => m[1]);
  for (const line of suite.lines) {
    table = table.replace(new RegExp(`(<tr data-tactic="${line.tactic}">)(.*?)(</tr>)`), (_, open, row, close) => {
      let column = 0;
      const cells = row.replace(/(<td data-verdict="[^"]+">)(.*?)(<\/td>)/g, (__, td, cell, tdEnd) => {
        const id = columns[column++];
        const first = characters[id].name.split(" ")[0];
        const link = `<a class="try" href="${escape(tryHref(id, line.input))}">Try it<span class="vh">: ${escape(line.tactic.toLowerCase())} on ${escape(first)}, in the playground</span></a>`;
        return `${td}${cell.replace(/ ?<a class="try".*?<\/a>/, "")} ${link}${tdEnd}`;
      });
      return `${open}${cells}${close}`;
    });
  }
  return html.slice(0, start) + table + html.slice(end);
}
