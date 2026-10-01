// Checks shared by Persuadable's and Game's restore(): a snapshot is plain JSON with a format version and a kind.
// Internal: not exported from index.js, and not reachable through the package's exports.

/** The snapshot format this version writes and reads. Bump it when a snapshot's shape changes, and read the old one. */
export const SNAPSHOT_FORMAT = 1;

const KINDS = { persuadable: "a character's (Persuadable)", game: "a game's (Game)" };
const RESTORE = { persuadable: "npc.restore()", game: "game.restore()" };

const describe = (v) => {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

/**
 * A checker for one snapshot. `fail(message)` throws the caller's own error type. Each check names the field and
 * says what was expected, so a damaged or mismatched save file explains itself.
 */
export function snapshotChecker(value, kind, fail) {
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObject(value)) fail(`This isn't a Honeytongue snapshot: expected an object from snapshot(), got ${describe(value)}`);
  if (value.format !== SNAPSHOT_FORMAT) {
    if (Number.isInteger(value.format) && value.format > SNAPSHOT_FORMAT) {
      fail(`This save was made by a newer version of Honeytongue (snapshot format ${value.format}); this version reads format ${SNAPSHOT_FORMAT}. Update Honeytongue to load it`);
    }
    fail(`This isn't a snapshot format Honeytongue knows: "format" should be ${SNAPSHOT_FORMAT}, got ${describe(value.format)}`);
  }
  if (value.kind !== kind) {
    fail(KINDS[value.kind]
      ? `This is ${KINDS[value.kind]} snapshot, not ${KINDS[kind]}: restore it with ${RESTORE[value.kind]}`
      : `This isn't a Honeytongue snapshot: "kind" should be "${kind}", got ${describe(value.kind)}`);
  }
  const field = (name, valid, rule) => {
    if (!valid(value[name])) fail(`Snapshot field "${name}" should be ${rule}, got ${describe(value[name])}`);
    return value[name];
  };
  return { field, isObject, describe };
}

/** Each value in an object is a count of 0 or more (reply rotation). */
export const isCounts = (v) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  Object.values(v).every((n) => Number.isInteger(n) && n >= 0);
export const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
