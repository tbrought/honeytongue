// Overrides for calibration runs, so a candidate rubric or persona can be measured before it goes into the
// library or the story files. A patch file looks like:
//   { "levels": [...], "characters": { "<id>": { "persona": "...", ... } } }
// "levels" applies to every character that doesn't set its own; "characters" overrides fields by character id
// (the preset key, or the story npc's id).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Every `--patch <file>` on the command line, in order. */
export function loadPatches(argv = process.argv) {
  const patches = [];
  argv.forEach((arg, i) => {
    if (arg === "--patch") patches.push({ file: argv[i + 1], ...JSON.parse(readFileSync(resolve(argv[i + 1]), "utf8")) });
  });
  return patches;
}

export const describePatches = (patches) => (patches.length ? patches.map((p) => p.file.split(/[\\/]/).pop()).join(" + ") : "none");

/** A character in Persuadable format, with the patches applied. */
export function patchCharacter(id, character, patches) {
  let c = { ...character };
  for (const p of patches) {
    if (p.levels && !character.levels) c.levels = p.levels;
    if (p.characters?.[id]) c = { ...c, ...p.characters[id] };
  }
  return c;
}

// Story npcs keep these fields at the top level; everything else lives in their persuasion block.
const NPC_FIELDS = ["name", "persona", "secrets", "patience", "repeatReaction"];

/** A copy of a story with the patches applied to its npcs. */
export function patchStory(story, patches) {
  const copy = structuredClone(story);
  for (const scene of Object.values(copy.scenes)) {
    const npc = scene.npc;
    if (!npc?.persuasion) continue;
    for (const p of patches) {
      if (p.levels && !npc.persuasion.levels) npc.persuasion.levels = p.levels;
      for (const [field, value] of Object.entries(p.characters?.[npc.id] ?? {})) {
        if (NPC_FIELDS.includes(field)) npc[field] = value;
        else npc.persuasion[field] = value;
      }
    }
  }
  return copy;
}
