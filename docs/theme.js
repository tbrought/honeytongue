// Remembers whether the reader picked the amber screen or the paper teletype look,
// and wires up the toggle in the status line. Loaded in <head> so there's no flash of the wrong theme.
(() => {
  const KEY = "honeytongue-theme";
  const root = document.documentElement;
  const dark = matchMedia("(prefers-color-scheme: dark)");
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") root.dataset.theme = saved;
  } catch { /* storage blocked: follow the system setting */ }

  const current = () => root.dataset.theme ?? (dark.matches ? "dark" : "light");

  addEventListener("DOMContentLoaded", () => {
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      const label = () => {
        const toPaper = current() === "dark";
        button.textContent = toPaper ? "Paper" : "Screen";
        button.setAttribute("aria-label", toPaper ? "Switch to the paper teletype look" : "Switch to the amber screen look");
      };
      label();
      dark.addEventListener?.("change", label);
      button.addEventListener("click", () => {
        root.dataset.theme = current() === "dark" ? "light" : "dark";
        try { localStorage.setItem(KEY, root.dataset.theme); } catch { /* not remembered this time */ }
        label();
      });
    }
  });
})();
