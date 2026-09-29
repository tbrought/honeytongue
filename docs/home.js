// The documentation home page: the copy button, and the status line that names the section you're in.
// (Moved out of index.html so the page needs no inline script.)
document.getElementById("copy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(document.getElementById("cmd").textContent);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select and copy";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 2000);
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
