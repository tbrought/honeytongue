// The text adventure engine, built on top of the persuasion module.
// Jev only interprets what the player meant (a Choice) and, via
// persuasion.js, how convincing they were (a Score). All state changes
// and narration come from the author's story file.

import { Persuadable, persuasionQuestions, readPersuasion, cleanInput, defineCharacter, HoneytongueError, ANGLES } from "./persuasion.js";
import { SOURCE } from "./jev.js";
import { SNAPSHOT_FORMAT, snapshotChecker, isCounts, isStrings } from "./snapshot.js";
import { parseMarkup, stripMarkup, stripMarkupDeep, markupProblems, hasMarkup } from "./markup.js";

const ACT_AT = 0.6;      // top option probability needed to act immediately
const CLARIFY_AT = 0.3;  // between CLARIFY_AT and ACT_AT, ask "did you mean..."
// Exported for the proxy's request guard (src/guard.js), which accepts only what the engine sends.
export const HISTORY = 4;        // recent turns sent to Jev for context
export const MAX_INPUT = 500;    // longer input is truncated
export const RESULT_LENGTH = 160; // characters of each recent turn's result
export const TURN_INPUT_LENGTH = 200; // characters of what the player typed, in each recent turn (a story's recentTurnLength)

const META = {
  unclear: "The input is gibberish, too vague to act on, or not an attempt to do anything",
  impossible: "A clear intention, but it matches none of the other options available here",
};
const MAX_ACTIONS = 255 - Object.keys(META).length; // Jev allows 255 options per Choice
// State fields holding what the player typed: sent exactly as typed, never read as markup. (recent_turns also holds
// the engine's replies, which are already plain: turns keep result.text.)
const PLAYER_TEXT = new Set(["player_input", "previous_attempts", "recent_turns"]);

/** A request's state for Jev: story text with its markup stripped, and what the player typed left exactly as it is. */
const stateForJev = (state) =>
  Object.fromEntries(Object.entries(state).map(([key, value]) => [key, PLAYER_TEXT.has(key) ? value : stripMarkupDeep(value)]));

// Answers to "Did you mean: 1) ... 2) ...?"
const PICKS = [
  /^(?:option )?(?:#?1|one|first|the first(?: one)?)[.)!]?$/i,
  /^(?:option )?(?:#?2|two|second|the second(?: one)?)[.)!]?$/i,
];

const has = (obj, key) => obj != null && Object.hasOwn(obj, key);

export class StoryError extends HoneytongueError {
  constructor(problems) {
    super(`Story has ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
    this.name = "StoryError";
    this.problems = problems;
  }
}

// Story NPCs keep persuasion settings in a nested block; flatten for Persuadable.
const toCharacter = (npc) => ({
  ...npc.persuasion,
  name: npc.name,
  persona: npc.persona,
  patience: npc.patience,
  secrets: npc.secrets,
  repeatReaction: npc.repeatReaction,
  // A story with angle replies needs the angle asked; one without asks only if its persuasion block says so.
  ...(npc.angleReplies !== undefined && { angles: true }),
});

// Story text players read, where markup (@[name], #[thing]) is allowed. "*" matches any scene or action id, and "#"
// any list position. Every other string (names, personas, goals, secrets, action descriptions, item and flag names)
// is sent to Jev or used as a name, so markup there is a mistake.
const DISPLAY_TEXT = [
  ["intro"],
  ["scenes", "*", "description"],
  ["scenes", "*", "actions", "*", "text"],
  ["scenes", "*", "actions", "*", "blockedText"],
  ["scenes", "*", "actions", "*", "label"],
  ["scenes", "*", "npc", "hostileReaction"],
  ["scenes", "*", "npc", "hostileReaction", "#"],
  ["scenes", "*", "npc", "repeatReaction"],
  ["scenes", "*", "npc", "repeatReaction", "#"],
  ["scenes", "*", "npc", "clueReplies", "*"],
  ["scenes", "*", "npc", "clueReplies", "*", "#"],
  ["scenes", "*", "npc", "angleReplies", "*"],
  ["scenes", "*", "npc", "angleReplies", "*", "#"],
  ["scenes", "*", "npc", "outOfPatience", "text"],
  ["scenes", "*", "npc", "persuasion", "success", "text"],
  ["scenes", "*", "npc", "persuasion", "reactions", "#", "text"],
  ["scenes", "*", "npc", "persuasion", "reactions", "#", "text", "#"],
];
const isDisplayText = (path) => DISPLAY_TEXT.some((pattern) => pattern.length === path.length &&
  pattern.every((p, i) => (p === "*" ? typeof path[i] === "string" : p === "#" ? typeof path[i] === "number" : p === path[i])));

/** Markup problems anywhere in a story: badly formed in text players read, or present where it can't be. */
function checkMarkup(story, problems) {
  const where = (path) => (path[0] === "scenes" && path.length > 2 ? `Scene "${path[1]}", ${path.slice(2).join(".")}` : path.join("."));
  const walk = (value, path) => {
    if (typeof value === "string") {
      if (isDisplayText(path)) for (const p of markupProblems(value)) problems.push(`${where(path)}: ${p}`);
      else if (hasMarkup(value)) {
        problems.push(`${where(path)}: markup (@[...] or #[...]) only works in text players read, like descriptions and replies. ` +
          "This is sent to Jev or used as a name, so write it plainly");
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i]));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
  };
  walk(story, []);
}

/** Check a story for mistakes before playing. Throws StoryError listing every problem found. */
export function validateStory(story) {
  const problems = [];
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const names = (v) => Array.isArray(v) && v.every(text);
  const lines = (v) => text(v) || (Array.isArray(v) && v.length > 0 && v.every(text)); // one reply, or variants in turn
  if (!isObject(story)) throw new StoryError(["Story must be an object"]);
  if (!text(story.title)) problems.push('Missing "title"');
  const scenes = isObject(story.scenes) ? story.scenes : {};
  if (!Object.keys(scenes).length) problems.push('Missing "scenes"');
  if (!text(story.start)) problems.push('Missing "start" (the id of the first scene)');
  else if (!has(scenes, story.start)) problems.push(`"start" points to scene "${story.start}", which doesn't exist`);
  for (const key of ["inventory", "flags"]) {
    if (story.player?.[key] !== undefined && !names(story.player[key])) problems.push(`"player.${key}" must be an array of strings`);
  }
  if (story.recentTurnLength !== undefined && !(Number.isInteger(story.recentTurnLength) && story.recentTurnLength > 0 && story.recentTurnLength <= MAX_INPUT)) {
    problems.push(`"recentTurnLength" must be a whole number of characters from 1 to ${MAX_INPUT}`);
  }

  const checkEffect = (effect, where) => {
    if (effect.goto !== undefined && !has(scenes, effect.goto)) problems.push(`${where}: goto "${effect.goto}" doesn't match any scene`);
    for (const key of ["setFlags", "giveItems", "takeItems"]) {
      if (effect[key] !== undefined && !names(effect[key])) problems.push(`${where}: "${key}" must be an array of strings`);
    }
    if (effect.patience !== undefined && !Number.isFinite(effect.patience)) {
      problems.push(`${where}: "patience" must be a number (negative costs patience, positive restores it)`);
    }
  };

  const npcsSeen = new Map(); // npc id -> { sid, definition }
  for (const [sid, scene] of Object.entries(scenes)) {
    const at = `Scene "${sid}"`;
    if (!isObject(scene)) { problems.push(`${at} must be an object`); continue; }
    if (!text(scene.description)) problems.push(`${at}: missing "description"`);
    if (scene.name !== undefined && !text(scene.name)) problems.push(`${at}: "name" must be a non-empty string`);
    if (scene.ending !== undefined) {
      if (!text(scene.ending)) problems.push(`${at}: "ending" must be the ending's name, like "You escaped"`);
      continue;
    }

    if (scene.actions !== undefined && !isObject(scene.actions)) problems.push(`${at}: "actions" must be an object of named actions`);
    const actions = isObject(scene.actions) ? scene.actions : {};
    const count = Object.keys(actions).length;
    if (!count) problems.push(`${at}: needs "actions" (or an "ending" if the story stops here)`);
    if (count > MAX_ACTIONS) problems.push(`${at}: has ${count} actions, but Jev can choose between at most ${MAX_ACTIONS}`);

    const npc = scene.npc;
    if (npc !== undefined && !isObject(npc)) problems.push(`${at}: "npc" must be an object`);
    else if (npc) {
      if (!text(npc.id)) problems.push(`${at}: npc needs an "id"`);
      else {
        const definition = JSON.stringify(npc);
        const seen = npcsSeen.get(npc.id);
        if (!seen) npcsSeen.set(npc.id, { sid, definition });
        else if (seen.definition !== definition) {
          problems.push(`${at}: npc id "${npc.id}" is also used in scene "${seen.sid}" with a different definition. ` +
            "Scenes sharing an id share one character (memory and patience), so copy the npc exactly or give it a new id");
        }
      }
      if (npc.persuasion) {
        try { defineCharacter(toCharacter(npc)); } catch (e) { problems.push(`${at}: ${e.message}`); }
        if (!text(npc.persuasion.success?.text)) problems.push(`${at}: npc.persuasion.success needs "text"`);
        else checkEffect(npc.persuasion.success, `${at} npc success`);
        // Only needed when something can offend them: offendedBy: [] means nothing does.
        const offendedBy = npc.persuasion.offendedBy;
        const canOffend = !(Array.isArray(offendedBy) && offendedBy.length === 0);
        if (npc.hostileReaction !== undefined ? !lines(npc.hostileReaction) : canOffend) {
          problems.push(`${at}: npc needs a "hostileReaction" (the line when threats or insults offend them, or a list of ` +
            "lines to use in turn)");
        }
        // Every clue needs the line the character says when it reveals their secret, and nothing else may have one.
        const clueIds = Array.isArray(npc.persuasion.clues) ? npc.persuasion.clues.map((k) => k?.id) : [];
        const clueReplies = npc.clueReplies ?? {};
        if (!isObject(clueReplies)) problems.push(`${at}: npc "clueReplies" must be an object of { clue id: reply }`);
        else {
          for (const id of clueIds) {
            if (!lines(clueReplies[id])) problems.push(`${at}: clue "${id}" needs a reply in "clueReplies" (what ${npc.name} says when it reveals their secret)`);
          }
          for (const id of Object.keys(clueReplies)) {
            if (!clueIds.includes(id)) problems.push(`${at}: "clueReplies" has "${id}", which isn't one of the npc's clues`);
          }
        }
        // Angle replies: by the library's angles ("other" means no clear appeal, so the score band's reaction is used).
        if (npc.angleReplies !== undefined) {
          if (!isObject(npc.angleReplies)) problems.push(`${at}: npc "angleReplies" must be an object of { angle: reply }`);
          else {
            for (const [angle, reply] of Object.entries(npc.angleReplies)) {
              if (!ANGLES.includes(angle) || angle === "other") {
                problems.push(`${at}: "angleReplies" has "${angle}", which isn't an angle: use ${ANGLES.filter((a) => a !== "other").map((a) => `"${a}"`).join(", ")}`);
              } else if (!lines(reply)) problems.push(`${at}: angle reply "${angle}" must be a non-empty string, or a list of them`);
            }
          }
        }
        if (Number.isFinite(npc.patience)) {
          if (!text(npc.outOfPatience?.text)) problems.push(`${at}: npc has finite patience, so it needs "outOfPatience" with "text"`);
          else checkEffect(npc.outOfPatience, `${at} npc outOfPatience`);
        }
      }
    }
    const persuadable = isObject(npc) && npc.persuasion;

    for (const [aid, action] of Object.entries(actions)) {
      const where = `${at}, action "${aid}"`;
      if (has(META, aid) || aid === "__proto__") problems.push(`${where}: "${aid}" is a reserved name`);
      if (!isObject(action)) { problems.push(`${where} must be an object`); continue; }
      if (!text(action.description)) problems.push(`${where}: missing "description" (Jev uses it to match player input)`);
      if (action.persuade && !persuadable) problems.push(`${where}: "persuade" needs an npc with "persuasion" in this scene`);
      if (!action.persuade && !text(action.text)) problems.push(`${where}: missing "text"`);
      if (action.patience !== undefined && !persuadable) problems.push(`${where}: "patience" needs an npc with "persuasion" in this scene`);
      const req = action.requires;
      if (req !== undefined && (!isObject(req) || (req.flags !== undefined && !names(req.flags)) || (req.items !== undefined && !names(req.items)))) {
        problems.push(`${where}: "requires" must look like { "flags": ["..."], "items": ["..."] }`);
      }
      checkEffect(action, where);
    }
  }
  checkMarkup(story, problems);
  if (problems.length) throw new StoryError(problems);
  return story;
}

/** A line the engine writes itself (not story text), or the ending's name. They carry no markup. */
const system = (text) => ({ kind: "system", text });
const endingLine = (name) => ({ kind: "ending", text: `— ${name} —` });

/**
 * A turn's reply from its lines: `text`, plain and in paragraphs as always, and `parts`, the same paragraphs as
 * meaningful pieces (see parseMarkup) for interfaces that style them. Paragraph i of text.split("\n\n") is parts[i].
 */
function reply(lines, debug) {
  const paragraphs = lines.filter((l) => (typeof l === "string" ? l : l?.text)).flatMap((l) =>
    typeof l === "string" ? l.split("\n\n").map((p) => parseMarkup(p)) : [[{ kind: l.kind, text: l.text }]]);
  const text = paragraphs.map((p) => p.map((part) => part.text).join("")).join("\n\n");
  return debug === undefined ? { text, parts: paragraphs } : { text, parts: paragraphs, debug };
}

export class Game {
  #attempt = null; // this turn's judgement by the scene's character: result.attempt (an attempt result plus threshold)
  #turnNpc = null; // the scene's character when the turn began (a success may move the player on)
  #queue = Promise.resolve(); // turns, one at a time
  #replies = new Map(); // "<npc id> <slot>" -> how many times the engine has used that reply, so variants come in turn

  constructor(story, jev) {
    if (typeof jev?.ask !== "function") {
      throw new HoneytongueError("Game needs a client as its second argument: createJevClient(), createProxyClient({ url }), or createMockClient()");
    }
    this.story = validateStory(story);
    this.jev = jev;
    this.sceneId = story.start;
    this.inventory = [...(story.player?.inventory ?? [])];
    this.flags = new Set(story.player?.flags ?? []);
    this.npcs = new Map();
    this.history = [];
    this.pending = null;
    this.over = Boolean(this.scene.ending);
  }

  get scene() {
    return this.story.scenes[this.sceneId];
  }

  /** The Persuadable for this scene's NPC, created on first use so it keeps its memory. */
  get npc() {
    const npc = this.scene.npc;
    if (!npc?.persuasion) return null;
    if (!this.npcs.has(npc.id)) this.npcs.set(npc.id, new Persuadable(toCharacter(npc), { client: this.jev }));
    return this.npcs.get(npc.id);
  }

  /** The title, intro, and first scene as plain text. To style them, use parseMarkup on story.intro and scene.description. */
  intro() {
    return stripMarkup([this.story.title, this.story.intro, this.scene.description].filter(Boolean).join("\n\n"));
  }

  // ---- The one Jev call per turn: action Choice + persuasion questions ----

  buildState(input) {
    const base = {
      scene: this.scene.description,
      player: { inventory: this.inventory, knows: [...this.flags] },
      recent_turns: this.history.slice(-HISTORY),
    };
    return this.npc
      ? { ...base, ...this.npc.state(input, { knows: [...this.flags] }) }
      : { ...base, player_input: input };
  }

  buildQuestions() {
    const criteria = Object.fromEntries(Object.entries(this.scene.actions).map(([id, a]) => [id, a.description]));
    Object.assign(criteria, META);

    return {
      action: {
        type: "choice",
        instructions:
          "Which option best matches what the player is trying to do in `player_input`? " +
          "Use `recent_turns` to resolve words like 'it' or 'her'.",
        criteria,
      },
      ...(this.npc && persuasionQuestions(this.npc.character)),
    };
  }

  /**
   * What this story sends to Jev from each playable scene: the scene description, the exact questions, and the
   * scene's character (defined), if it has one. The proxy's guard uses it to accept only this story's requests.
   */
  static requests(story) {
    const game = new Game(story, { ask: async () => ({}) });
    return Object.entries(game.story.scenes).filter(([, s]) => !s.ending).map(([id]) => {
      game.sceneId = id;
      // The same stripping interpret() does, so the proxy expects exactly what the engine sends.
      const { scene, questions } = stripMarkupDeep({ scene: game.scene.description, questions: game.buildQuestions() });
      return { scene, questions, character: game.npc?.character ?? null };
    });
  }

  /** Ask Jev what the player meant. `ranked` only contains real options, most likely first. */
  async interpret(input) {
    // The one place the engine talks to Jev. Markup is for display only, so it's stripped from all the story text
    // sent: Jev judges the same plain text with or without it. What the player typed goes exactly as typed.
    const answers = await this.jev.ask(stateForJev(this.buildState(input)), stripMarkupDeep(this.buildQuestions()));
    const known = (id) => has(this.scene.actions, id) || has(META, id);
    const action = answers?.action;
    const ranked = Object.entries(action?.probabilities ?? {})
      .filter(([id, p]) => known(id) && Number.isFinite(p))
      .sort((a, b) => b[1] - a[1]);
    // No usable probabilities: fall back to the single choice, or treat the input as unclear.
    if (!ranked.length) ranked.push(known(action?.choice) ? [action.choice, action.confidence ?? 1] : ["unclear", 1]);
    return { answers, ranked };
  }

  // ---- Turn handling -------------------------------------------------------

  /**
   * Play one turn. Turns run one at a time, in order, even if you call this again before the last one finishes.
   * The result's `attempt` is how the scene's character judged it (the same fields as a Persuadable's attempt(), plus
   * `threshold`), or null when no character judged this turn. It's a stable part of the API; `debug` isn't.
   */
  turn(raw) {
    const run = this.#queue.then(async () => {
      const { text, parts, debug } = await this.#turn(raw);
      const attempt = this.#attempt;
      return debug === undefined ? { text, parts, attempt } : { text, parts, attempt, debug };
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async #turn(raw) {
    this.#attempt = null;
    if (this.over) return reply([system("The story has ended. Start a new game to play again.")]);
    const input = cleanInput(raw, MAX_INPUT);
    if (!input) return reply([]);
    this.#turnNpc = this.npc;

    const fast = this.fastPath(input);
    if (fast) return reply(fast);

    // Player answering a "did you mean 1 or 2?" prompt.
    if (this.pending) {
      const { options, input: original, answers } = this.pending;
      this.pending = null;
      const pick = options[PICKS.findIndex((re) => re.test(input))];
      if (pick) return this.perform(pick, original, answers, this.#debugFor(answers, [[pick, 1]]));
    }

    // Repeats of a failed argument are handled locally: no Jev call.
    if (this.npc?.findRepeat(input)) return this.perform("__repeat", input, null, { ranked: [] });

    const { answers, ranked } = await this.interpret(input);
    const debug = this.#debugFor(answers, ranked.slice(0, 3));
    const [top, p] = ranked[0];
    const second = ranked[1]?.[0];
    const unclear = top === "unclear" || p < CLARIFY_AT;
    const ambiguous = !unclear && top !== "impossible" && p < ACT_AT && second !== undefined && !has(META, second);

    // An insult the parser can't pin to an action still gets a reaction, and nothing else.
    if ((unclear || ambiguous || top === "impossible") && this.isHostile(answers)) {
      const lines = [];
      this.react(lines, answers);
      return this.finish(lines, input, debug);
    }
    if (unclear) return reply([system("You're not sure how to do that. Try saying it another way.")], this.#withOutcome(debug));
    if (top === "impossible") return reply([system("That isn't something you can do here.")], this.#withOutcome(debug));
    if (ambiguous) {
      this.pending = { options: [top, second], input, answers };
      const d = (id) => stripMarkup(this.scene.actions[id].label ?? this.scene.actions[id].description);
      return reply([system(`Did you mean:\n  1) ${d(top)}\n  2) ${d(second)}`)], this.#withOutcome(debug));
    }
    return this.perform(top, input, answers, debug);
  }

  #debugFor(answers, ranked) {
    return { source: answers[SOURCE], ranked, persuasion: answers.persuasion, threats: answers.threats, insults: answers.insults, maxScore: this.npc?.character.maxScore };
  }

  /** How the turn went for the scene's character: the verdict (if it was judged), their threshold, the tells triggered, and patience left. */
  #withOutcome(debug) {
    const npc = this.#turnNpc;
    return Object.assign(debug, {
      verdict: this.#attempt?.verdict ?? null,
      threshold: npc?.character.threshold ?? null,
      triggered: this.#attempt?.triggered ?? [],
      patienceLeft: npc ? npc.patienceLeft : null,
    });
  }

  /** The lines for commands answered without Jev (look, inventory, help), or null. */
  fastPath(input) {
    const t = input.toLowerCase();
    if (/^(l|look|look around)$/.test(t)) return [this.scene.description];
    if (/^(i|inv|inventory)$/.test(t)) {
      return [system(this.inventory.length ? `You're carrying: ${this.inventory.join(", ")}.` : "You're empty-handed.")];
    }
    if (/^(h|help|\?)$/.test(t)) {
      return [system("Type what you want to do in plain English. Talk your way through if you can.\n" +
        "Shortcuts: look, inventory, debug (show Jev's reasoning), quit.")];
    }
    return null;
  }

  perform(actionId, input, answers, debug) {
    const action = actionId === "__repeat" ? { persuade: true } : this.scene.actions[actionId];
    const lines = [];

    if (!this.meetsRequirements(action)) {
      lines.push(action.blockedText ?? system("You can't do that yet."));
      this.react(lines, answers);
    } else if (action.persuade && this.npc) {
      this.persuade(input, answers, lines);
    } else {
      // The NPC reacts to what was said before the action moves the player anywhere else.
      lines.push(action.text);
      // One penalty per turn: hostile words with a costly action (a threat while grabbing the key) are charged once,
      // at the larger of the two costs, not both.
      const actionCost = Math.max(0, -(action.patience ?? 0));
      const offendedCost = this.npc?.character.offendedCost ?? 0;
      const both = actionCost > 0 && this.isHostile(answers);
      this.react(lines, answers, both && actionCost > offendedCost ? 0 : offendedCost);
      const sceneBefore = this.sceneId;
      this.apply(action, lines, { skipPatience: both && offendedCost >= actionCost });
      // A clue in what the player did or said, after the action's own effects (asking about the toy horse already
      // teaches Harry's secret, so his clue adds nothing), and only while they're still with the character.
      if (this.sceneId === sceneBefore && !this.over) this.#revealClue(answers, lines);
    }
    return this.finish(lines, input, debug);
  }

  /** On a turn that isn't a persuasion attempt: a matched clue that teaches a new secret, with its reply. */
  #revealClue(answers, lines) {
    const npc = this.npc;
    if (!npc || !answers || this.isHostile(answers)) return;
    const { clue } = readPersuasion(npc.character, answers, { knows: [...this.flags] });
    if (!clue?.revealed) return;
    npc.learn(clue.reveals);
    this.flags.add(clue.reveals);
    lines.push(this.#clueReply(clue));
  }

  /** What the scene's character says when a clue reveals their secret. */
  #clueReply(clue) {
    const npc = this.scene.npc;
    return this.#nextLine(`${npc.id} clue ${clue.id}`, npc.clueReplies[clue.id]);
  }

  finish(lines, input, debug) {
    const result = reply(lines, debug && this.#withOutcome(debug));
    // Recent turns are context for words like "it" or "her": the start of what was typed is plenty.
    const player = cleanInput(input, this.story.recentTurnLength ?? TURN_INPUT_LENGTH);
    this.history = [...this.history, { player, result: result.text.slice(0, RESULT_LENGTH) }].slice(-HISTORY);
    return result;
  }

  /** Whether this turn's tells would offend the NPC: the same rule persuasion uses. */
  isHostile(answers) {
    return Boolean(this.npc) && readPersuasion(this.npc.character, answers).verdict === "offended";
  }

  /** NPCs react to threats and insults whatever the player was doing, not just when persuading. */
  react(lines, answers, cost = this.npc?.character.offendedCost ?? 0) {
    if (this.over || !this.isHostile(answers)) return;
    const npc = this.npc; // before the out-of-patience effect can move the player on
    const judged = readPersuasion(npc.character, answers);
    // If this uses up the last of their patience, the out-of-patience text says it all.
    if (!this.#exhausts(cost)) lines.push(this.hostileReaction());
    this.drain(cost, lines);
    // Judged by the tells alone, during some other action: the same fields as an attempt, after the penalty.
    this.#attempt = { ...judged, patienceLeft: npc.patienceLeft, outOfPatience: npc.outOfPatience, threshold: npc.character.threshold };
  }

  /** Whether losing this much patience now would use up the last of it. */
  #exhausts(cost) {
    return cost > 0 && !this.npc.outOfPatience && this.npc.patienceLeft - cost <= 0;
  }

  /** A decide() hook can make an NPC offended even when nothing in offendedBy can. */
  hostileReaction() {
    const npc = this.scene.npc;
    if (npc.hostileReaction === undefined) return system(`${npc.name} takes offence.`);
    return this.#nextLine(`${npc.id} hostile`, npc.hostileReaction);
  }

  /** One line of a story reply: the reply itself, or its variants in turn (counted per character and slot). */
  #nextLine(slot, lines) {
    const used = this.#replies.get(slot) ?? 0;
    this.#replies.set(slot, used + 1);
    return Array.isArray(lines) ? lines[used % lines.length] : lines;
  }

  // ---- Save and load ----------------------------------------------------------

  /**
   * The game's state as plain JSON, for a save file: the scene, items, flags, recent turns, a question waiting
   * for an answer, whether it's over, each character's state, and where each list of reply variants is up to.
   * The story isn't included: restore() puts the state back into a Game made with the same story.
   */
  snapshot() {
    return {
      format: SNAPSHOT_FORMAT,
      kind: "game",
      story: this.story.title,
      scene: this.sceneId,
      inventory: [...this.inventory],
      flags: [...this.flags],
      history: this.history.map((h) => ({ ...h })),
      pending: this.pending && structuredClone(this.pending),
      over: this.over,
      npcs: Object.fromEntries([...this.npcs].map(([id, npc]) => [id, npc.snapshot()])),
      replies: Object.fromEntries(this.#replies),
    };
  }

  /**
   * Put back a snapshot() of this game, for example from a save file. It's checked first: a snapshot of another
   * story, from a newer Honeytongue, naming a scene, action, or character this story doesn't have, or with a
   * damaged field throws a HoneytongueError saying which, and leaves the game as it was.
   */
  restore(snapshot) {
    const fail = (message) => { throw new HoneytongueError(`Can't restore this game: ${message}.`); };
    const { field, isObject } = snapshotChecker(snapshot, "game", fail);
    if (snapshot.story !== this.story.title) {
      fail(`this snapshot is of the story ${JSON.stringify(snapshot.story)}, not ${JSON.stringify(this.story.title)}`);
    }
    const scenes = this.story.scenes;
    const scene = field("scene", (v) => typeof v === "string" && Object.hasOwn(scenes, v), "the id of a scene in this story");
    const inventory = field("inventory", isStrings, "a list of item names");
    const flags = field("flags", isStrings, "a list of flag names");
    const history = field("history", (v) => Array.isArray(v) && v.length <= HISTORY &&
      v.every((h) => isObject(h) && typeof h.player === "string" && typeof h.result === "string"),
      `a list of at most ${HISTORY} { player, result } turns`);
    const actions = scenes[scene].actions ?? {};
    const pending = field("pending", (v) => v === null || (isObject(v) && typeof v.input === "string" && isObject(v.answers) &&
      Array.isArray(v.options) && v.options.every((o) => typeof o === "string" && Object.hasOwn(actions, o))),
      `null, or a question waiting for an answer about actions in scene "${scene}"`);
    const over = field("over", (v) => typeof v === "boolean", "true or false");
    const definitions = new Map(Object.values(scenes).filter((s) => s.npc?.persuasion).map((s) => [s.npc.id, s.npc]));
    const saved = field("npcs", (v) => isObject(v) && Object.keys(v).every((id) => definitions.has(id)),
      `the characters' snapshots, by the ids of characters in this story (${[...definitions.keys()].join(", ") || "none"})`);
    const replies = field("replies", isCounts, "counts of how often each reply has been used");
    // Each character is restored into a new Persuadable first, so a bad one leaves the game untouched.
    const npcs = new Map(Object.entries(saved).map(([id, state]) =>
      [id, new Persuadable(toCharacter(definitions.get(id)), { client: this.jev }).restore(state)]));

    this.sceneId = scene;
    this.inventory = [...inventory];
    this.flags = new Set(flags);
    this.history = history.map((h) => ({ player: h.player, result: h.result }));
    this.pending = pending && structuredClone(pending);
    this.over = over;
    this.npcs = npcs;
    this.#replies = new Map(Object.entries(replies));
    this.#attempt = null;
    this.#turnNpc = null;
    return this;
  }

  // ---- Persuasion: the module judges, the story narrates --------------------

  persuade(input, answers, lines) {
    const npc = this.scene.npc;
    // Only reachable when success or outOfPatience doesn't move the player on.
    if (this.npc.convinced || this.npc.outOfPatience) {
      lines.push(system(this.npc.convinced ? `${npc.name} has already agreed.` : `${npc.name} has stopped listening.`));
      return;
    }

    // The engine's flags are the secrets the player has learned (they're what the state sent to Jev).
    const result = this.npc.record(input, answers, { knows: [...this.flags] });
    if (result.clue?.revealed) this.flags.add(result.clue.reveals);
    this.#attempt = { ...result, threshold: this.npc.character.threshold };
    if (result.verdict === "convinced") {
      lines.push(npc.persuasion.success.text);
      this.apply(npc.persuasion.success, lines);
    } else if (result.outOfPatience) {
      // The attempt that uses up the last of their patience gets only the out-of-patience text, not an
      // encouraging reaction followed by the end of the scene.
      this.runOutOfPatience(lines);
    } else if (result.clue?.revealed) {
      // A good guess becomes progress: they tell you, instead of turning you down.
      lines.push(this.#clueReply(result.clue));
    } else if (result.verdict === "offended") {
      lines.push(this.hostileReaction());
    } else {
      lines.push(this.#angleReply(result) ?? result.reaction);
    }
  }

  /**
   * The reply to what an unconvinced line appealed to, when the story has one and Jev is sure enough (angleAt).
   * A near-miss band ("nearMiss": true) keeps its own reaction: hints matter more than a reply to the angle.
   */
  #angleReply(result) {
    const npc = this.scene.npc;
    const c = this.npc.character;
    const { angle } = result;
    if (result.verdict !== "unconvinced" || !angle || angle.confidence < c.angleAt) return null;
    const reply = npc.angleReplies?.[angle.angle];
    if (reply === undefined) return null;
    const band = [...c.reactions].sort((a, b) => b.min - a.min).find((r) => (result.score ?? 0) >= r.min);
    if (band?.nearMiss) return null;
    return this.#nextLine(`${npc.id} angle ${angle.angle}`, reply);
  }

  /** Change the NPC's patience. Running out plays their outOfPatience effect, once. */
  drain(amount, lines) {
    const wasOut = this.npc.outOfPatience;
    if (this.npc.losePatience(amount) && !wasOut) this.runOutOfPatience(lines);
  }

  runOutOfPatience(lines) {
    const effect = this.scene.npc.outOfPatience;
    lines.push(effect.text);
    this.apply(effect, lines);
  }

  // ---- Effects -------------------------------------------------------------

  meetsRequirements(action) {
    const req = action.requires ?? {};
    return (req.flags ?? []).every((f) => this.flags.has(f)) &&
      (req.items ?? []).every((i) => this.inventory.includes(i));
  }

  apply(effect, lines, { skipPatience = false } = {}) {
    for (const f of effect.setFlags ?? []) this.flags.add(f);
    for (const i of effect.takeItems ?? []) this.inventory = this.inventory.filter((x) => x !== i);
    for (const i of effect.giveItems ?? []) if (!this.inventory.includes(i)) this.inventory.push(i);
    if (effect.patience && !skipPatience && this.npc && !this.over) this.drain(-effect.patience, lines);
    if (effect.goto && !this.over) {
      this.sceneId = effect.goto;
      this.pending = null;
      lines.push(this.scene.description);
      if (this.scene.ending) {
        this.over = true;
        lines.push(endingLine(this.scene.ending));
      }
    }
  }
}
