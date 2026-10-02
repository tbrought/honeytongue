// The documentation pages (the home page and the guide): the home page's copy button, the guide's checklist copied as a
// task list, and the status line that names the section you're in. (Moved out of index.html so the pages need no inline
// script.)
document.getElementById("copy")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(document.getElementById("cmd").textContent);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select and copy";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 2000);
});

// The guide's checklist as a Markdown task list, which GitHub shows as checkboxes in an issue or a pull request.
function checklistMarkdown() {
  const text = (node) => [...node.childNodes].map((n) =>
    n.nodeType === Node.TEXT_NODE ? n.textContent : n.localName === "code" ? `\`${n.textContent}\`` : text(n)).join("");
  const items = [...document.querySelectorAll(".checklist li")].map((li) => `- [ ] ${text(li).replace(/\s+/g, " ").trim()}`);
  const page = document.querySelector('link[rel="canonical"]')?.href ?? location.href.split("#")[0];
  return `Before you ship a character (${page}#checklist):\n\n${items.join("\n")}\n`;
}
document.getElementById("copy-checklist")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(checklistMarkdown());
    button.textContent = "Copied";
  } catch {
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => { button.textContent = "Copy as task list"; }, 2000);
});

// The status line names the section you're in, like the room name at the top of an Infocom screen.
const room = document.getElementById("room");
const sections = [...document.querySelectorAll("main section[id]")];
const exits = new Map([...document.querySelectorAll("nav.exits a")].map((a) => [a.hash.slice(1), a]));
let queued = false;
function whereAmI() {
  queued = false;
  const here = sections.filter((s) => s.getBoundingClientRect().top < innerHeight * 0.3).pop();
  const name = here ? here.querySelector("h2").textContent : "Honeytongue";
  const link = room.firstElementChild;
  if (link.textContent !== name) {
    link.textContent = name;
    link.href = here ? `#${here.id}` : "#top";
  }
  for (const [id, a] of exits) {
    if (id === here?.id) a.setAttribute("aria-current", "location");
    else a.removeAttribute("aria-current");
  }
}
addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(whereAmI); } }, { passive: true });
whereAmI();
