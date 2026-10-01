// ---- Jev answers -------------------------------------------------------------

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  /** Can be fractional, from 0 to the number of levels minus 1. */
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface NoulAnswer {
  type: "noul";
  /** Probability of "yes", from 0 to 1. */
  noul: number;
}
export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface JevClient {
  ask(state: unknown, questions: Record<string, unknown>): Promise<Record<string, any>>;
}

export class HoneytongueError extends Error {
  /** The HTTP status, when the error came from a failed request. */
  status?: number;
  /**
   * Why a proxy refused or failed, when it said: "version", "not-allowed", or "state" (a 403 from a guarded proxy),
   * or "busy", "error", or "unavailable" (a 502: Jev didn't answer; "unavailable" means a bad key or no credit).
   */
  reason?: "version" | "not-allowed" | "state" | "busy" | "error" | "unavailable" | (string & {});
  /** With a proxy's 403: the Honeytongue versions of the proxy and of the request (null if it didn't say). */
  proxyVersion?: string | null;
  requestVersion?: string | null;
}
export class StoryError extends HoneytongueError {
  problems: string[];
}

// ---- Characters and persuasion ----------------------------------------------

export interface Secret {
  /** Matches the id you pass to learn() or in `knows`. */
  id: string;
  /** Only counts in the player's favor once they've learned it. */
  fact: string;
}

/** Something a line can do that teaches the player a secret, such as guessing at the character's family. */
export interface Clue {
  /** Names the clue in results and in a story's clueReplies. Not "none". */
  id: string;
  /** What the line does, as Jev is asked it: "Asks about or guesses at his family". At most 255 characters. */
  when: string;
  /** The id of the secret it teaches. */
  reveals: string;
}

/**
 * What an argument appeals to. A fixed set, defined and calibrated by the library so it means the same in every game;
 * it's public API from 0.1.0, since changing it would change every game's results. "other" is no clear appeal.
 * "benefit" is something the character wants for themselves other than money or goods.
 */
export type Angle = "family" | "compassion" | "money" | "benefit" | "duty" | "authority" | "fear" | "flattery" | "honesty" | "reason" | "other";

/** Every angle, in the order the angle question lists them. */
export const ANGLES: readonly Angle[];

/** Which angle a line appealed to (asked only for characters with angles: true). */
export interface AngleSignal {
  angle: Angle;
  /** Jev's probability for that angle. The engine uses its angle replies at angleAt or above. */
  confidence: number;
  /** Every angle's probability, for games that want to weigh mixed arguments themselves. */
  probabilities: Record<Angle, number>;
}

/** A clue a line matched (from the clue question, asked only for characters with clues). */
export interface ClueMatch {
  id: string;
  reveals: string;
  /** Jev's probability for this clue, at least clueAt. */
  confidence: number;
  /**
   * True when it teaches the player a secret they hadn't learned and the line didn't offend: a Persuadable learns it,
   * and that attempt costs no patience. After that, lines matching it are judged and charged as usual.
   */
  revealed: boolean;
}

/** Signs of hostility Jev checks every attempt for, each as its own yes/no question. */
export type Tell = "threats" | "insults";

/**
 * A threshold as a share of the top rubric level: easy 60%, normal 80%, hard 90%, very hard 95%.
 * At runtime case and surrounding spaces are ignored, and "very-hard" or "very_hard" also work.
 */
export type Difficulty = "easy" | "normal" | "hard" | "very hard";

/** A reply: one line, or a non-empty list of variants used in turn so it rarely repeats. */
export type Lines = string | readonly string[];

export interface DecideContext {
  /** The attempt, cleaned and capped. */
  input: string;
  character: DefinedCharacter;
  /** Earlier attempts, oldest first. Empty for judgePersuasion() unless you passed previousAttempts. */
  previousAttempts: readonly Attempt[];
  /** Before this attempt's cost. The full patience for judgePersuasion(). */
  patienceLeft: number;
}

/**
 * Overrule a verdict. Return a verdict, or nothing to keep the original. Must be synchronous.
 * Patience and other state follow the returned verdict. Not applied by readPersuasion().
 */
export type DecideHook = (result: Readonly<PersuasionResult>, context: DecideContext) => Verdict | undefined | void;

export interface Character {
  name: string;
  persona: string;
  goal: string;
  /** How hard they are to convince. Default "normal". */
  difficulty?: Difficulty;
  /** An exact score to convince, above 0 and at most the top level. If you also set difficulty, the two must agree. */
  threshold?: number;
  /** Tells that offend: an offensive attempt fails, whatever its score. Default ["threats", "insults"]. [] means nothing offends. */
  offendedBy?: Tell[];
  /** Ordered rubric, weakest to strongest, 2 to 10 entries. Defaults to DEFAULT_LEVELS. */
  levels?: string[];
  /** Probability at which a tell counts as present, above 0 and at most 1. Default 0.7. */
  hostileAt?: number;
  /** Your own rule for the final verdict. Not available in JSON stories. */
  decide?: DecideHook;
  /** Failed attempts allowed before running out of patience, above 0. Default Infinity. */
  patience?: number;
  /** Patience lost per unconvinced or repeated attempt. Default 1. */
  failCost?: number;
  /** Patience lost per offensive attempt. Default 2. */
  offendedCost?: number;
  /**
   * The previous attempts sent with each attempt: the last `memory` attempts, or `memoryLength` characters of them,
   * whichever runs out first (the oldest go first). Default 10. `state()` shows exactly what an attempt sends.
   */
  memory?: number;
  /** See `memory`. Default 1500 characters. A proxy's allowedCharacters enforces each character's own value. */
  memoryLength?: number;
  /** Word overlap (above 0, at most 1) with a failed attempt that counts as repeating. Default 0.8. */
  repeatSimilarity?: number;
  /** Longer input is truncated. Default 500 characters. */
  maxInputLength?: number;
  /**
   * Reaction text for unconvinced attempts, picked by the highest `min` reached. `text` may be a list of variants:
   * a Persuadable uses each band's variants in turn, so replies rarely repeat (judgePersuasion gives the first).
   */
  reactions?: { min: number; text: Lines; nearMiss?: boolean }[];
  /** Reaction text for repeated attempts: one line, or variants used in turn. */
  repeatReaction?: Lines;
  /** Facts the player must discover before they help an argument. */
  secrets?: Secret[];
  /** Lines that teach the player a secret, such as a guess about the character's family. Each attempt asks about them. */
  clues?: Clue[];
  /** Probability at which a clue counts as matched. Default 0.8. */
  clueAt?: number;
  /** Ask which angle each attempt appeals to (result.angle). Default false; a story with angleReplies turns it on. */
  angles?: boolean;
  /** The confidence at which the engine uses an angle's reply. Default 0.6. */
  angleAt?: number;
  /**
   * Lets attempt() send `context` through a proxy with allowedCharacters: at most this many characters of it as JSON.
   * Without it, such a proxy refuses context. attempt() checks the limit too, so you find out before deploying.
   */
  maxContextLength?: number;
}

/**
 * A character with every default filled in, as returned by defineCharacter(). `threshold` is always set; `difficulty`
 * is kept (in its canonical spelling) when a word was given. A copy with other changes, like
 * { ...npc.character, patience: 5 }, can be passed back in; if you change its difficulty or levels, leave out `threshold`.
 */
export type DefinedCharacter = Required<Omit<Character, "repeatReaction" | "decide" | "difficulty" | "maxContextLength">> & {
  threshold: number;
  difficulty?: Difficulty;
  maxContextLength?: number;
  repeatReaction?: Lines;
  decide?: DecideHook;
  maxScore: number;
};

export type Verdict = "convinced" | "unconvinced" | "offended" | "repeated";

export interface PersuasionResult {
  verdict: Verdict;
  /** null when the attempt was a repeat and wasn't sent to Jev. */
  score: number | null;
  maxScore: number;
  /** Each tell's probability. null when the attempt was a repeat and wasn't sent to Jev. */
  tells: Record<Tell, number> | null;
  /** Tells at or above hostileAt, whether or not they offend. A repeated offence keeps the original's. */
  triggered: Tell[];
  confidence: number | null;
  /** Text for unconvinced and repeated verdicts; null otherwise. */
  reaction: string | null;
  /** The clue the line matched, or null (no clues, no match, or a repeat, which isn't sent to Jev). */
  clue: ClueMatch | null;
  /** What the line appealed to, or null (the character doesn't ask for angles, or a repeat). */
  angle: AngleSignal | null;
}

export interface AttemptResult extends PersuasionResult {
  patienceLeft: number;
  outOfPatience: boolean;
}

export interface AttemptOptions {
  /**
   * Extra game state for Jev to consider, e.g. { player_gold: 12 }. JSON data. Through a proxy with allowedCharacters,
   * the character needs a maxContextLength.
   */
  context?: unknown;
  /** Secret ids the player has learned. Defaults to those passed to learn(). */
  knows?: string[];
}

export interface Attempt {
  said: string;
  outcome: Verdict;
}

export const DEFAULT_LEVELS: string[];
/** This copy of Honeytongue's version, like "0.1.0-alpha.6". */
export const VERSION: string;
export function defineCharacter(character: Character): DefinedCharacter;
export function cleanInput(input: unknown, maxLength?: number): string;
export function similarity(a: string, b: string): number;
export function persuasionQuestions(character: Character): Record<string, unknown>;
export function persuasionState(
  character: Character, input: string,
  options?: AttemptOptions & { previousAttempts?: Attempt[] },
): Record<string, unknown>;
/** `knows` (secret ids already learned) only decides whether a matched clue is `revealed`. */
export function readPersuasion(character: Character, answers: Record<string, any> | null, options?: { knows?: string[] }): PersuasionResult;
export function judgePersuasion(
  client: JevClient, character: Character, input: string,
  options?: AttemptOptions & { previousAttempts?: Attempt[] },
): Promise<PersuasionResult>;

/**
 * A character that remembers past attempts, notices repeats, and runs out of patience. Its state can be read, but only
 * changed through its methods.
 */
export class Persuadable {
  constructor(character: Character, options?: { client?: JevClient });
  character: DefinedCharacter;
  /** The attempts so far, oldest first (at most the last 100), as a read-only copy. */
  readonly attempts: readonly Readonly<Attempt>[];
  /** The secret ids the player has learned, as a copy: learn() adds one. */
  readonly knows: ReadonlySet<string>;
  readonly patienceLeft: number;
  readonly convinced: boolean;
  readonly outOfPatience: boolean;
  /**
   * Attempts run one at a time, in the order they were made. It still asks Jev once the character is convinced or out
   * of patience: check those first if your game shouldn't pay for that.
   */
  attempt(input: string, options?: AttemptOptions): Promise<AttemptResult>;
  /** `knows`: the secrets the state you sent listed, if you passed your own (a clue only reveals what isn't among them). */
  record(input: string, answers: Record<string, any> | null, options?: { knows?: string[] }): AttemptResult;
  /** Marks a secret as learned. Throws HoneytongueError for an id that isn't one of the character's secrets. */
  learn(secretId: string): void;
  findRepeat(input: string): Attempt | null;
  /** Exactly the state an attempt with this input would send to Jev. */
  state(input: string, options?: AttemptOptions): Record<string, unknown>;
  /** Negative amounts restore patience. Patience never drops below 0. Returns outOfPatience. */
  losePatience(amount?: number): boolean;
  reset(): void;
  /** This character's state as plain JSON, for a save file. The character itself isn't included. */
  snapshot(): PersuadableSnapshot;
  /**
   * Puts back a snapshot() of this character. Throws HoneytongueError, leaving the character as it was, if the
   * snapshot is for another character, from a newer Honeytongue, or damaged. Returns this character.
   */
  restore(snapshot: PersuadableSnapshot): this;
}

/** A Persuadable's state as plain JSON (from snapshot()), for save files. */
export interface PersuadableSnapshot {
  /** The snapshot format: 1. A newer Honeytongue may write a higher one, which this version refuses to restore. */
  format: 1;
  kind: "persuadable";
  /** The character's name, checked on restore. */
  character: string;
  attempts: { said: string; outcome: Verdict; triggered?: Tell[] }[];
  knows: string[];
  /** null for unlimited patience (JSON has no Infinity). */
  patienceLeft: number | null;
  convinced: boolean;
  /** How many times each reply slot has been used, so lists of variants carry on in turn. */
  replies: Record<string, number>;
}

// ---- Stories and the text adventure engine ------------------------------------

export interface Effect {
  goto?: string;
  setFlags?: string[];
  /** Items the player already carries aren't given twice. */
  giveItems?: string[];
  takeItems?: string[];
  /** Negative costs the scene NPC's patience, positive restores it. */
  patience?: number;
}

export interface StoryAction extends Effect {
  /** What Jev matches the player's input against. */
  description: string;
  /** Shown when the player is asked "Did you mean...". Defaults to the description. */
  label?: string;
  /** Required unless `persuade` is true. */
  text?: string;
  /** Treat this action as an attempt to persuade the scene's NPC. */
  persuade?: boolean;
  requires?: { flags?: string[]; items?: string[] };
  blockedText?: string;
}

export interface StoryNpc {
  /** Scenes that share an id share one character: its memory and patience. */
  id: string;
  name: string;
  persona: string;
  patience?: number;
  secrets?: Secret[];
  /** Required unless offendedBy is []. One line, or variants used in turn. */
  hostileReaction?: Lines;
  repeatReaction?: Lines;
  /** What they say when a clue reveals their secret, by clue id. Every clue in persuasion.clues needs one. */
  clueReplies?: Record<string, Lines>;
  /**
   * What they say to an unconvinced line by what it appealed to, when Jev is at least angleAt sure. A near-miss band
   * ("nearMiss": true) keeps its own reaction. Having these turns on the angle question for this character.
   */
  angleReplies?: Partial<Record<Exclude<Angle, "other">, Lines>>;
  /** Required when patience is finite. Plays once, when patience first runs out. */
  outOfPatience?: Effect & { text: string };
  /** Settings such as difficulty, offendedBy, and threshold go here. decide is only available in stories built in code. */
  persuasion?: Omit<Character, "name" | "persona" | "patience" | "secrets" | "repeatReaction"> & {
    success: Effect & { text: string };
  };
}

export interface Scene {
  /** A room name for your interface to show, like "East Gate" in a status line. The engine doesn't narrate it. */
  name?: string;
  description: string;
  /** The ending's name, e.g. "You escaped". Endings need no actions. */
  ending?: string;
  npc?: StoryNpc;
  actions?: Record<string, StoryAction>;
}

export interface Story {
  title: string;
  intro?: string;
  start: string;
  player?: { inventory?: string[]; flags?: string[] };
  scenes: Record<string, Scene>;
  /**
   * Recent turns sent with each turn, for words like "it": the last 4 turns, each with up to `recentTurnLength`
   * characters of what the player typed (default 200, at most 500) and 160 of the reply. A proxy's allowedStories
   * enforces each story's own value.
   */
  recentTurnLength?: number;
}

/** How a turn was judged, for debugging. Not a stable part of the API: its fields may change in any version. */
export interface TurnDebug {
  /** Who answered this turn, when the client says: Jev, or the offline mock (directly or behind a proxy). */
  source?: "jev" | "mock";
  /** The top options with their probabilities, most likely first. Empty for a repeat, which is caught locally and not sent to Jev. */
  ranked: [string, number][];
  persuasion?: ScoreAnswer;
  threats?: NoulAnswer;
  insults?: NoulAnswer;
  maxScore?: number;
  /** The scene character's verdict on this turn, or null if the turn wasn't judged (such as an ordinary action). */
  verdict?: Verdict | null;
  /** The scene character's threshold when the turn began, or null if the scene has no character. */
  threshold?: number | null;
  /** Tells triggered on a judged turn. */
  triggered?: Tell[];
  /** The scene character's patience after the turn (Infinity if unlimited), or null if the scene has no character. */
  patienceLeft?: number | null;
}

// ---- Story markup ----------------------------------------------------------------

/**
 * What a piece of a reply is. Story text: plain "text", "speech" (found from double quotes), a "character" (@[name]),
 * or an "item" (#[thing]). The engine's own lines are "system", and the ending's name is "ending". Meaning only:
 * how each kind looks is up to your interface.
 */
export type PartKind = "text" | "speech" | "character" | "item" | "system" | "ending";

export interface Part {
  kind: PartKind;
  text: string;
  /** Set on a character or item named inside speech. */
  inSpeech?: true;
}

/**
 * A paragraph of story text as parts, in order. Joining the parts' text gives stripMarkup(text). Only story markup
 * and speech are found here; "system" and "ending" parts come from the engine.
 */
export function parseMarkup(text: string): Part[];
/** Text with markup removed and escapes (\@[ and \#[) resolved: what a plain-text interface shows, and what Jev sees. */
export function stripMarkup(text: string): string;

export interface TurnResult {
  /** The reply as plain text, paragraphs separated by a blank line. Never contains markup. */
  text: string;
  /**
   * The same reply for styling: one array of parts per paragraph, so parts[i] is paragraph i of
   * text.split("\n\n"). A stable part of the API; see "Story markup" in the docs.
   */
  parts: Part[][];
  /**
   * How the scene's character judged this turn: the same fields as a Persuadable's attempt() result, plus the
   * character's `threshold`. null when no character judged it (an ordinary action, a look around, a clarifying
   * question). A stable part of the API: use it for verdict labels, scores, and patience.
   */
  attempt: (AttemptResult & { threshold: number }) | null;
  /** Diagnostics: the ranked actions, Jev's raw answers, and who answered. May change in any version; use `attempt` instead. */
  debug?: TurnDebug | null;
}

/**
 * Checks a story and returns it, typed as a Story. Throws StoryError listing every problem. Takes any value, so a
 * story imported from JSON (where TypeScript widens "hard" to string) can be passed in without a cast.
 */
export function validateStory(story: unknown): Story;

export class Game {
  constructor(story: Story, client: JevClient);
  story: Story;
  sceneId: string;
  inventory: string[];
  flags: Set<string>;
  over: boolean;
  /** Set while a "Did you mean" question is waiting for the player's answer. */
  pending: { options: [string, string]; input: string; answers: Record<string, any> } | null;
  readonly scene: Scene;
  /** The Persuadable for the current scene's NPC, or null. */
  readonly npc: Persuadable | null;
  /** The title, intro, and first scene as plain text. To style them, use parseMarkup on story.intro and scene.description. */
  intro(): string;
  /** Turns run one at a time, in the order they were sent. */
  turn(input: string): Promise<TurnResult>;
  interpret(input: string): Promise<{ answers: Record<string, any>; ranked: [string, number][] }>;
  /** What a story sends to Jev from each playable scene (used by the proxy's allowedStories). */
  static requests(story: Story): { scene: string; questions: Record<string, any>; character: DefinedCharacter | null }[];
  /** The game's state as plain JSON, for a save file. The story itself isn't included. */
  snapshot(): GameSnapshot;
  /**
   * Puts back a snapshot() of this game. Throws HoneytongueError, leaving the game as it was, if the snapshot is of
   * another story, from a newer Honeytongue, names a scene, action, or character the story doesn't have, or is damaged.
   * Returns this game.
   */
  restore(snapshot: GameSnapshot): this;
}

/** A Game's state as plain JSON (from snapshot()), for save files. */
export interface GameSnapshot {
  format: 1;
  kind: "game";
  /** The story's title, checked on restore. */
  story: string;
  scene: string;
  inventory: string[];
  flags: string[];
  history: { player: string; result: string }[];
  pending: { options: string[]; input: string; answers: Record<string, any> } | null;
  over: boolean;
  /** Each character met so far, by its id. */
  npcs: Record<string, PersuadableSnapshot>;
  replies: Record<string, number>;
}

// ---- Clients and the proxy -----------------------------------------------------

export interface ClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export function createJevClient(options?: ClientOptions & {
  apiKey?: string;
  url?: string;
  /** The Jev model. Falls back to the TYPESAFE_MODEL environment variable, then the pinned default "jev-1.13.0". */
  model?: string;
  /** The most time the whole call may take, retries and waits included, in milliseconds. Default: no deadline. */
  deadlineMs?: number;
  dangerouslyAllowBrowser?: boolean;
}): JevClient;
export function createProxyClient(options: ClientOptions & { url: string; headers?: Record<string, string> }): JevClient;

/** The second argument your platform passes to the handler, such as a Cloudflare Worker's env. */
export interface ProxyEnv {
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  [key: string]: unknown;
}

interface ProxyHandlerBaseOptions {
  apiKey?: string;
  /** The Jev model. Falls back to TYPESAFE_MODEL (Worker env, then process env), then "jev-1.13.0". */
  model?: string;
  client?: JevClient;
  /**
   * Cross-origin pages allowed to call the proxy. Same-origin requests are always allowed. This only controls
   * browsers: scripts and servers send no Origin and aren't affected. allowedStories and allowedCharacters are what
   * protect your key.
   */
  allowedOrigins?: string[];
  /** Questions allowed per request. Default 8; the engine sends 4 to 6 (5 with clues, 6 with clues and angles). */
  maxQuestions?: number;
  /** Limit on the whole request body, in bytes. Default 16000. */
  maxStateBytes?: number;
  maxInputLength?: number;
  /**
   * Per client address, per server instance. false turns it off. Clients whose address can't be found (no
   * CF-Connecting-IP on Cloudflare, no X-Forwarded-For elsewhere) share one "unknown" address: set clientIp.
   */
  rateLimit?: { requests: number; windowMs: number } | false;
  /** How to find the client's address. Defaults to CF-Connecting-IP on Cloudflare, else the last X-Forwarded-For entry. */
  clientIp?: (request: Request, env?: ProxyEnv) => string;
}

/**
 * A proxy needs to know which requests are your game's: allowedStories (for the text adventure engine) and/or
 * allowedCharacters (for Persuadable and judgePersuasion). Anything else gets a 403 with a `reason`.
 * dangerouslyAllowAnyRequest: true forwards any well-formed request instead: for local tools only, never a public proxy.
 */
export type ProxyHandlerOptions = ProxyHandlerBaseOptions & (
  | { allowedStories: Story[]; allowedCharacters?: Character[]; dangerouslyAllowAnyRequest?: false }
  | { allowedStories?: Story[]; allowedCharacters: Character[]; dangerouslyAllowAnyRequest?: false }
  | { allowedStories?: Story[]; allowedCharacters?: Character[]; dangerouslyAllowAnyRequest: true }
);

export type ProxyHandler = (request: Request, env?: ProxyEnv) => Promise<Response>;
export function createProxyHandler(options: ProxyHandlerOptions): ProxyHandler;

/** The parts of Node's IncomingMessage that toNodeListener uses. */
export interface NodeRequestLike extends AsyncIterable<Uint8Array> {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}
/** The parts of Node's ServerResponse that toNodeListener uses. */
export interface NodeResponseLike {
  readonly headersSent: boolean;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  end(chunk?: Uint8Array | string): unknown;
}
/**
 * A Node http listener for a proxy handler: http.createServer(toNodeListener(handle)). Bodies over `maxBytes` (default
 * 16000; match maxStateBytes) are refused as they arrive. The handler's env is `env` plus the socket's `remoteAddress`.
 */
export function toNodeListener(
  handle: ProxyHandler,
  options?: { maxBytes?: number; env?: ProxyEnv },
): (req: NodeRequestLike, res: NodeResponseLike) => Promise<void>;

export function createMockClient(): JevClient;
