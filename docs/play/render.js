// Builds the web demo's elements from game results. Everything shown (story text, replies, what the player typed,
// title cards, the ending screen) goes in as text nodes, never as HTML, so nothing in it can become markup or
// script. Takes the document as a parameter, so test/render.test.js can check that with a stand-in document.
import { VERDICT_LABELS, spokenLabel, scoreLine } from "./present.js";

export function makeRenderer(doc) {
  /** Build an element. Props are fixed in the code; children are nodes or strings, and strings become text. */
  function el(tag, props = {}, ...children) {
    const node = doc.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }
  const hidden = (node) => { node.setAttribute("aria-hidden", "true"); return node; };

  /** A paragraph's parts as spans, one class per kind: part-character, part-item, part-speech, part-system. */
  function partsNode(parts) {
    const span = el("span");
    for (const part of parts) {
      if (part.kind === "text") span.append(part.text);
      else span.append(el("span", { className: `part-${part.kind}${part.inSpeech ? " part-in-speech" : ""}` }, part.text));
    }
    return span;
  }

  /**
   * One paragraph. When it will type out, screen readers get the whole text at once from a hidden copy, and the
   * typing copy is hidden from them. A verdict label, if the verdict has one, goes first, spoken as a word ("Convinced.").
   */
  function paragraph(parts, { verdict, animate, className = "" } = {}) {
    const p = el("p", { className });
    const plain = parts.map((x) => x.text).join("");
    const spoken = verdict ? `${spokenLabel(verdict)} ` : "";
    const body = partsNode(parts);
    if (animate) { hidden(body); p.append(el("span", { className: "vh" }, spoken + plain)); }
    else if (spoken) p.append(el("span", { className: "vh" }, spoken));
    if (VERDICT_LABELS[verdict]) p.append(hidden(el("span", { className: "chip" }, VERDICT_LABELS[verdict])));
    p.append(body);
    return { p, body };
  }

  /** A title card for a named scene, as a heading. */
  function titleCard(name) {
    const rule = () => hidden(el("span", { className: "card-rule" }, "════════════════"));
    return el("h2", { className: "card" }, rule(), el("span", { className: "card-title" }, name), rule());
  }

  /** What the player typed, echoed after the prompt. */
  const commandLine = (text) => el("p", { className: "cmd" }, text);

  /**
   * The ending screen: the ending, the turns taken, the arguments that landed and the closest misses (from
   * endingSummary), and what next. `onPlayAgain` and `onSave` are the page's; `onSave` is left out when not recording.
   */
  function endingScreen({ ending, stats, landed, closest, who, onPlayAgain, onSave }) {
    const quote = (t, note) => el("li", {}, `"${t.input}"`, el("span", { className: "dim" }, note));
    const again = el("button", { type: "button", className: "key", onclick: onPlayAgain }, "Play again");
    const section = el("section", { className: "end-screen", ariaLabel: "The end" },
      hidden(el("p", { className: "ending-mark" }, "*** THE END ***")),
      el("h2", { className: "ending-title", tabIndex: -1 }, ending),
      el("p", { className: "ending-stats" }, stats.join(" · ")),
      ...(landed.length ? [el("h3", {}, "Arguments that landed"), el("ol", {}, ...landed.map((t) => quote(t, `Convinced ${who}: ${scoreLine(t)}`)))] : []),
      ...(closest.length ? [el("h3", {}, "Closest misses"), el("ol", {}, ...closest.map((t) => quote(t, scoreLine(t))))] : []),
      el("div", { className: "again" }, again,
        el("a", { href: "#", className: "key" }, "Try another scene"),
        ...(onSave ? [el("button", { type: "button", className: "key", onclick: onSave }, "Save transcript")] : []),
        el("a", { href: "../", className: "key" }, "Back to the docs")));
    return { section, again };
  }

  /** The privacy note shown while Jev may judge, linking to TypeSafe's privacy policy. */
  const privacy = () => el("span", {}, "What you type is sent to ",
    el("a", { href: "https://typesafe.ai/legal/privacy-policy", target: "_blank", rel: "noopener" }, "TypeSafe"),
    "'s Jev model to be judged, and TypeSafe may store it. Don't type anything personal.");

  /** The banner's contents, from fallback.js's banner(). */
  const bannerNode = ({ label, detail, privacy: withPrivacy }) =>
    el("span", {}, el("strong", {}, label), detail, ...(withPrivacy ? [" ", privacy()] : []));

  return { el, hidden, partsNode, paragraph, titleCard, commandLine, endingScreen, bannerNode };
}
