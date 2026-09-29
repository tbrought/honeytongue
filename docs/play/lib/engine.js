// The text adventure engine, built on top of the persuasion module.
// Jev only interprets what the player meant (a Choice) and, via
// persuasion.js, how convincing they were (a Score). All state changes
// and narration come from the author's story file.

import { Persuadable, persuasionQuestions, readPersuasion, cleanInput, defineCharacter, HoneytongueError } from "./persuasion.js";
import { SOURCE } from "./jev.js";

const ACT_AT = 0.6;      // top option probability needed to act immediately
const CLARIFY_AT = 0.3;  // between CLARIFY_AT and ACT_AT, ask "did you mean..."
// Exported for the proxy's request guard (src/guard.js), which accepts only what the engine sends.
export const HISTORY = 4;        // recent turns sent to Jev for context
export const MAX_INPUT = 500;    // longer input is truncated
export const RESULT_LENGTH = 160; // characters of each recent turn's result

const META = {
  unclear: "The input is gibberish, too vague to act on, or not an attempt to do anything",
  impossible: "A clear intention, but it matches none of the other options available here",
};
const MAX_ACTIONS = 255 - Object.keys(META).length; // Jev allows 255 options per Choice

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
});

/** Check a story for mistakes before playing. Throws StoryError listing every problem found. */
export function validateStory(story) {
  const problems = [];
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const names = (v) => Array.isArray(v) && v.every(text);
  if (!isObject(story)) throw new StoryError(["Story must be an object"]);
  if (!text(story.title)) problems.push('Missing "title"');
  const scenes = isObject(story.scenes) ? story.scenes : {};
  if (!Object.keys(scenes).length) problems.push('Missing "scenes"');
  if (!text(story.start)) problems.push('Missing "start" (the id of the first scene)');
  else if (!has(scenes, story.start)) problems.push(`"start" points to scene "${story.start}", which doesn't exist`);
  for (const key of ["inventory", "flags"]) {
    if (story.player?.[key] !== undefined && !names(story.player[key])) problems.push(`"player.${key}" must be an array of strings`);
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
        if (npc.hostileReaction !== undefined ? !text(npc.hostileReaction) : canOffend) {
          problems.push(`${at}: npc needs a "hostileReaction" (the line when threats or insults offend them)`);
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
  if (problems.length) throw new StoryError(problems);
  return story;
}

export class Game {
  #judged = null;  // this turn's persuasion outcome, for debug: { verdict, triggered }
  #turnNpc = null; // the scene's character when the turn began (a success may move the player on)

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
    this.queue = Promise.resolve();
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

  intro() {
    return `${this.story.title}\n\n${this.story.intro ?? ""}\n\n${this.scene.description}`.trim();
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
      return { scene: game.scene.description, questions: game.buildQuestions(), character: game.npc?.character ?? null };
    });
  }

  /** Ask Jev what the player meant. `ranked` only contains real options, most likely first. */
  async interpret(input) {
    const answers = await this.jev.ask(this.buildState(input), this.buildQuestions());
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

  /** Play one turn. Turns run one at a time, in order, even if you call this again before the last one finishes. */
  turn(raw) {
    const run = this.queue.then(() => this.#turn(raw));
    this.queue = run.catch(() => {});
    return run;
  }

  async #turn(raw) {
    if (this.over) return { text: "The story has ended. Start a new game to play again." };
    const input = cleanInput(raw, MAX_INPUT);
    if (!input) return { text: "" };
    this.#judged = null;
    this.#turnNpc = this.npc;

    const fast = this.fastPath(input);
    if (fast) return { text: fast };

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
    if (unclear) return { text: "You're not sure how to do that. Try saying it another way.", debug: this.#withOutcome(debug) };
    if (top === "impossible") return { text: "That isn't something you can do here.", debug: this.#withOutcome(debug) };
    if (ambiguous) {
      this.pending = { options: [top, second], input, answers };
      const d = (id) => this.scene.actions[id].label ?? this.scene.actions[id].description;
      return { text: `Did you mean:\n  1) ${d(top)}\n  2) ${d(second)}`, debug: this.#withOutcome(debug) };
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
      verdict: this.#judged?.verdict ?? null,
      threshold: npc?.character.threshold ?? null,
      triggered: this.#judged?.triggered ?? [],
      patienceLeft: npc ? npc.patienceLeft : null,
    });
  }

  fastPath(input) {
    const t = input.toLowerCase();
    if (/^(l|look|look around)$/.test(t)) return this.scene.description;
    if (/^(i|inv|inventory)$/.test(t)) {
      return this.inventory.length ? `You're carrying: ${this.inventory.join(", ")}.` : "You're empty-handed.";
    }
    if (/^(h|help|\?)$/.test(t)) {
      return "Type what you want to do in plain English. Talk your way through if you can.\n" +
        "Shortcuts: look, inventory, debug (show Jev's reasoning), quit.";
    }
    return null;
  }

  perform(actionId, input, answers, debug) {
    const action = actionId === "__repeat" ? { persuade: true } : this.scene.actions[actionId];
    const lines = [];

    if (!this.meetsRequirements(action)) {
      lines.push(action.blockedText ?? "You can't do that yet.");
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
      this.apply(action, lines, { skipPatience: both && offendedCost >= actionCost });
    }
    return this.finish(lines, input, debug);
  }

  finish(lines, input, debug) {
    const text = lines.filter(Boolean).join("\n\n");
    this.history = [...this.history, { player: input, result: text.slice(0, RESULT_LENGTH) }].slice(-HISTORY);
    return { text, debug: debug && this.#withOutcome(debug) };
  }

  /** Whether this turn's tells would offend the NPC: the same rule persuasion uses. */
  isHostile(answers) {
    return Boolean(this.npc) && readPersuasion(this.npc.character, answers).verdict === "offended";
  }

  /** NPCs react to threats and insults whatever the player was doing, not just when persuading. */
  react(lines, answers, cost = this.npc?.character.offendedCost ?? 0) {
    if (this.over || !this.isHostile(answers)) return;
    this.#judged = { verdict: "offended", triggered: readPersuasion(this.npc.character, answers).triggered };
    // If this uses up the last of their patience, the out-of-patience text says it all.
    if (!this.#exhausts(cost)) lines.push(this.hostileReaction());
    this.drain(cost, lines);
  }

  /** Whether losing this much patience now would use up the last of it. */
  #exhausts(cost) {
    return cost > 0 && !this.npc.outOfPatience && this.npc.patienceLeft - cost <= 0;
  }

  /** A decide() hook can make an NPC offended even when nothing in offendedBy can. */
  hostileReaction() {
    const npc = this.scene.npc;
    return npc.hostileReaction ?? `${npc.name} takes offence.`;
  }

  // ---- Persuasion: the module judges, the story narrates --------------------

  persuade(input, answers, lines) {
    const npc = this.scene.npc;
    // Only reachable when success or outOfPatience doesn't move the player on.
    if (this.npc.convinced || this.npc.outOfPatience) {
      lines.push(this.npc.convinced ? `${npc.name} has already agreed.` : `${npc.name} has stopped listening.`);
      return;
    }

    const result = this.npc.record(input, answers);
    this.#judged = { verdict: result.verdict, triggered: result.triggered };
    if (result.verdict === "convinced") {
      lines.push(npc.persuasion.success.text);
      this.apply(npc.persuasion.success, lines);
    } else if (result.outOfPatience) {
      // The attempt that uses up the last of their patience gets only the out-of-patience text, not an
      // encouraging reaction followed by the end of the scene.
      this.runOutOfPatience(lines);
    } else {
      lines.push(result.verdict === "offended" ? this.hostileReaction() : result.reaction);
    }
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
        lines.push(`— ${this.scene.ending} —`);
      }
    }
  }
}
