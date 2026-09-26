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

/** Signs of hostility Jev checks every attempt for, each as its own yes/no question. */
export type Tell = "threats" | "insults";

/**
 * A threshold as a share of the top rubric level: easy 60%, normal 80%, hard 90%, very hard 95%.
 * At runtime case and surrounding spaces are ignored, and "very-hard" or "very_hard" also work.
 */
export type Difficulty = "easy" | "normal" | "hard" | "very hard";

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
  /** How many previous attempts are sent as context. Default 4. */
  memory?: number;
  /** Word overlap (above 0, at most 1) with a failed attempt that counts as repeating. Default 0.8. */
  repeatSimilarity?: number;
  /** Longer input is truncated. Default 500 characters. */
  maxInputLength?: number;
  /** Reaction text for unconvinced attempts, picked by the highest `min` reached. */
  reactions?: { min: number; text: string }[];
  /** Reaction text for repeated attempts. */
  repeatReaction?: string;
  /** Facts the player must discover before they help an argument. */
  secrets?: Secret[];
}

/**
 * A character with every default filled in, as returned by defineCharacter(). `threshold` is always set; `difficulty`
 * is kept (in its canonical spelling) when a word was given. A copy with other changes, like
 * { ...npc.character, patience: 5 }, can be passed back in; if you change its difficulty or levels, leave out `threshold`.
 */
export type DefinedCharacter = Required<Omit<Character, "repeatReaction" | "decide" | "difficulty">> & {
  threshold: number;
  difficulty?: Difficulty;
  repeatReaction?: string;
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
}

export interface AttemptResult extends PersuasionResult {
  patienceLeft: number;
  outOfPatience: boolean;
}

export interface AttemptOptions {
  /** Extra game state for Jev to consider, e.g. { player_gold: 12 }. */
  context?: unknown;
  /** Secret ids the player has learned. Defaults to those passed to learn(). */
  knows?: string[];
}

export interface Attempt {
  said: string;
  outcome: Verdict;
}

export const DEFAULT_LEVELS: string[];
export function defineCharacter(character: Character): DefinedCharacter;
export function cleanInput(input: unknown, maxLength?: number): string;
export function similarity(a: string, b: string): number;
export function persuasionQuestions(character: Character): Record<string, unknown>;
export function persuasionState(
  character: Character, input: string,
  options?: AttemptOptions & { previousAttempts?: Attempt[] },
): Record<string, unknown>;
export function readPersuasion(character: Character, answers: Record<string, any> | null): PersuasionResult;
export function judgePersuasion(
  client: JevClient, character: Character, input: string,
  options?: AttemptOptions & { previousAttempts?: Attempt[] },
): Promise<PersuasionResult>;

export class Persuadable {
  constructor(character: Character, options?: { client?: JevClient });
  character: DefinedCharacter;
  attempts: Attempt[];
  knows: Set<string>;
  patienceLeft: number;
  convinced: boolean;
  readonly outOfPatience: boolean;
  /** Attempts run one at a time, in the order they were made. */
  attempt(input: string, options?: AttemptOptions): Promise<AttemptResult>;
  record(input: string, answers: Record<string, any> | null): AttemptResult;
  learn(secretId: string): void;
  findRepeat(input: string): Attempt | null;
  state(input: string, options?: AttemptOptions): Record<string, unknown>;
  /** Negative amounts restore patience. Patience never drops below 0. Returns outOfPatience. */
  losePatience(amount?: number): boolean;
  reset(): void;
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
  /** Required unless offendedBy is []. */
  hostileReaction?: string;
  repeatReaction?: string;
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
}

export interface TurnDebug {
  /** Who answered this turn, when the client says: Jev, or the offline mock (directly or behind a proxy). */
  source?: "jev" | "mock";
  /** The top options with their probabilities, most likely first. */
  ranked: [string, number][];
  persuasion?: ScoreAnswer;
  threats?: NoulAnswer;
  insults?: NoulAnswer;
  maxScore?: number;
}

export interface TurnResult {
  text: string;
  debug?: TurnDebug | null;
}

export function validateStory<T>(story: T): T;

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
  intro(): string;
  /** Turns run one at a time, in the order they were sent. */
  turn(input: string): Promise<TurnResult>;
  interpret(input: string): Promise<{ answers: Record<string, any>; ranked: [string, number][] }>;
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
  dangerouslyAllowBrowser?: boolean;
}): JevClient;
export function createProxyClient(options: ClientOptions & { url: string; headers?: Record<string, string> }): JevClient;

/** The second argument your platform passes to the handler, such as a Cloudflare Worker's env. */
export interface ProxyEnv {
  TYPESAFE_API_KEY?: string;
  TYPESAFE_MODEL?: string;
  [key: string]: unknown;
}

export interface ProxyHandlerOptions {
  apiKey?: string;
  /** The Jev model. Falls back to TYPESAFE_MODEL (Worker env, then process env), then "jev-1.13.0". */
  model?: string;
  client?: JevClient;
  /** Cross-origin pages allowed to call the proxy. Same-origin requests are always allowed. */
  allowedOrigins?: string[];
  /** Questions allowed per request. Default 6; the engine sends 4. */
  maxQuestions?: number;
  /** Limit on the whole request body, in bytes. Default 16000. */
  maxStateBytes?: number;
  maxInputLength?: number;
  /** Per client address, per server instance. false turns it off. */
  rateLimit?: { requests: number; windowMs: number } | false;
  /** How to find the client's address. Defaults to CF-Connecting-IP on Cloudflare, else the last X-Forwarded-For entry. */
  clientIp?: (request: Request, env?: ProxyEnv) => string;
}

export function createProxyHandler(options?: ProxyHandlerOptions): (request: Request, env?: ProxyEnv) => Promise<Response>;

export function createMockClient(): JevClient;
