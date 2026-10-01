// Type test for Honeytongue's public API: `npm run typecheck` compiles this file (and never runs it) against
// src/index.d.ts and the two subpaths, imported by package name as a user would. Lines marked @ts-expect-error
// must fail to compile: if one starts compiling, the types have become too loose and the typecheck fails.
import {
  Persuadable, judgePersuasion, readPersuasion, defineCharacter, persuasionQuestions, persuasionState,
  cleanInput, similarity, HoneytongueError, StoryError, DEFAULT_LEVELS, VERSION,
  Game, validateStory, createJevClient, createProxyClient, createProxyHandler, createMockClient,
  parseMarkup, stripMarkup,
} from "honeytongue";
import type {
  Character, DefinedCharacter, Verdict, Tell, Difficulty, PersuasionResult, AttemptResult, Attempt,
  Story, TurnResult, TurnDebug, JevClient, ProxyHandlerOptions, ProxyEnv, DecideHook, Part, PartKind,
  PersuadableSnapshot, GameSnapshot,
} from "honeytongue";
import * as persuasion from "honeytongue/persuasion";
import type { Character as SubpathCharacter, JevClient as SubpathClient } from "honeytongue/persuasion";
import { createProxyHandler as subpathHandler } from "honeytongue/proxy";
import type { ProxyHandlerOptions as SubpathOptions, ProxyEnv as SubpathEnv } from "honeytongue/proxy";
// @ts-expect-error: the proxy entry point only has createProxyHandler and its types
import { Game as NotInProxy } from "honeytongue/proxy";
import gatehouseJson from "../stories/gatehouse.json" with { type: "json" };
import tidyProfitJson from "../stories/tidy-profit.json" with { type: "json" };

/** Compiles only if `value` is assignable to T. */
function expectType<T>(value: T): T {
  return value;
}
/** Compiles only if A and B are exactly the same type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const exact = <A, B>(_: Equal<A, B>) => {};

const harry: Character = {
  name: "Harry Goatleaf",
  persona: "An honest gatekeeper who hates flattery.",
  goal: "Open the gate",
  difficulty: "hard",
  offendedBy: ["threats"],
  patience: 5,
  secrets: [{ id: "sick_daughter", fact: "His daughter has a fever." }],
  reactions: [{ min: 0, text: ["Harry shrugs.", "Harry yawns."] }, { min: 2.5, text: "Harry hesitates." }],
  repeatReaction: ["You said that.", "Still no."] as const,
  decide: (result, context) => (result.verdict === "offended" && context.patienceLeft > 3 ? "unconvinced" : undefined),
};

async function persuasionApi(client: JevClient) {
  const defined = defineCharacter(harry);
  expectType<number>(defined.threshold);
  expectType<number>(defined.maxScore);
  expectType<Difficulty | undefined>(defined.difficulty);
  expectType<Tell[]>(defined.offendedBy);

  const npc = new Persuadable(harry, { client });
  const result = await npc.attempt("Please, my letter is urgent.", { knows: ["sick_daughter"] });
  exact<typeof result, AttemptResult>(true);
  expectType<Verdict>(result.verdict);
  expectType<boolean>(result.outOfPatience);
  // @ts-expect-error: the score is null for a repeat, so it must be checked first
  result.score.toFixed(2);
  if (result.score !== null) expectType<number>(result.score);
  expectType<Record<Tell, number> | null>(result.tells);
  expectType<readonly Readonly<Attempt>[]>(npc.attempts);
  expectType<ReadonlySet<string>>(npc.knows);
  // @ts-expect-error: a Persuadable's state is read-only; its methods change it
  npc.patienceLeft = 3;
  // @ts-expect-error: ...including its attempts
  npc.attempts = [];
  npc.learn("sick_daughter");
  expectType<boolean>(npc.losePatience(-1));
  npc.reset();

  const once = await judgePersuasion(client, harry, "Open up.", { previousAttempts: [{ said: "Hi", outcome: "unconvinced" }] });
  exact<typeof once, PersuasionResult>(true);
  expectType<PersuasionResult>(readPersuasion(harry, { persuasion: { score: 3 } }));
  expectType<Record<string, unknown>>(persuasionQuestions(harry));
  expectType<Record<string, unknown>>(persuasionState(harry, "hi", { knows: [], context: { gold: 3 } }));
  expectType<string>(cleanInput("  hi  ", 10));
  expectType<number>(similarity("a b", "b c"));
  expectType<string[]>(DEFAULT_LEVELS);
  expectType<string>(VERSION);

  const hook: DecideHook = () => "convinced";
  // @ts-expect-error: decide must return a verdict or nothing
  const badHook: DecideHook = () => "maybe";
  // @ts-expect-error: not a verdict
  const verdict: Verdict = "persuaded";
  // @ts-expect-error: persona is required
  new Persuadable({ name: "Nib", goal: "Open the cage" });
  // @ts-expect-error: not a difficulty word
  defineCharacter({ ...harry, difficulty: "impossible" });
  // @ts-expect-error: only threats and insults are tells
  defineCharacter({ ...harry, offendedBy: ["rudeness"] });
  // @ts-expect-error: patience is a number
  defineCharacter({ ...harry, patience: "5" });
  // Save and load: plain JSON in, the same character out.
  const saving = new Persuadable(harry, { client });
  const saved: PersuadableSnapshot = JSON.parse(JSON.stringify(saving.snapshot()));
  expectType<Persuadable>(saving.restore(saved));
  expectType<number | null>(saved.patienceLeft);
  // @ts-expect-error: a game's snapshot isn't a character's
  saving.restore({} as GameSnapshot);
  // @ts-expect-error: a reaction's variants are text
  defineCharacter({ ...harry, reactions: [{ min: 0, text: ["Hmm.", 2] }] });
}

async function engineApi(client: JevClient) {
  // validateStory types a JSON story as a Story, which TypeScript can't do by itself: it widens "hard" to string.
  const story = validateStory(tidyProfitJson);
  exact<typeof story, Story>(true);
  // @ts-expect-error: without validateStory (or a cast), a JSON story with a difficulty isn't a Story
  const unchecked: Story = tidyProfitJson;
  const game = new Game(story, client);
  const save: GameSnapshot = game.snapshot();
  expectType<Game>(game.restore(save));
  expectType<Record<string, PersuadableSnapshot>>(save.npcs);
  const turn = await game.turn("look");
  exact<typeof turn, TurnResult>(true);
  // The stable judgement: attempt()'s result plus the threshold, or null.
  expectType<(AttemptResult & { threshold: number }) | null>(turn.attempt);
  if (turn.attempt) {
    expectType<Verdict>(turn.attempt.verdict);
    expectType<number>(turn.attempt.threshold);
    expectType<number>(turn.attempt.patienceLeft);
  }
  const debug: TurnDebug | null | undefined = turn.debug;
  if (debug) {
    expectType<[string, number][]>(debug.ranked);
    expectType<"jev" | "mock" | undefined>(debug.source);
  }
  // Parts carry meaning only; how each kind looks is up to the interface.
  for (const paragraph of turn.parts) {
    for (const part of paragraph) {
      expectType<PartKind>(part.kind);
      expectType<string>(part.text);
      expectType<true | undefined>(part.inSpeech);
      // @ts-expect-error: parts never carry presentation, such as a colour
      part.color;
    }
  }
  expectType<Part[]>(parseMarkup("@[Harry] waves."));
  expectType<string>(stripMarkup("#[letter]"));
  // @ts-expect-error: not a kind of part
  const badKind: PartKind = "bold";
  expectType<Persuadable | null>(game.npc);
  expectType<string>(game.intro());
  for (const r of Game.requests(story)) expectType<DefinedCharacter | null>(r.character);
  // @ts-expect-error: a game needs a client
  new Game(story);
}

function clientsAndProxy() {
  expectType<JevClient>(createJevClient({ model: "jev-1.13.0", timeoutMs: 5000 }));
  expectType<JevClient>(createProxyClient({ url: "https://api.example/judge", maxRetries: 0 }));
  expectType<JevClient>(createMockClient());
  // @ts-expect-error: the proxy client needs a url
  createProxyClient({});

  const options: ProxyHandlerOptions = {
    allowedOrigins: ["https://honeytongue.dev"],
    allowedStories: [validateStory(gatehouseJson)],
    allowedCharacters: [harry],
    rateLimit: { requests: 20, windowMs: 60_000 },
    clientIp: (request, env) => request.headers.get("CF-Connecting-IP") ?? String(env?.REGION ?? "unknown"),
  };
  const handle = createProxyHandler(options);
  const response: Promise<Response> = handle(new Request("https://api.example/judge"), { TYPESAFE_API_KEY: "k" } satisfies ProxyEnv);
  // @ts-expect-error: allowedStories is an array of stories
  createProxyHandler({ allowedStories: validateStory(gatehouseJson) });
  // @ts-expect-error: rateLimit is settings or false
  createProxyHandler({ allowedCharacters: [harry], rateLimit: true });
  // @ts-expect-error: a proxy needs allowedStories or allowedCharacters...
  createProxyHandler({ allowedOrigins: ["https://honeytongue.dev"] });
  // @ts-expect-error: ...and the options aren't optional
  createProxyHandler();
  // ...unless it's told to forward anything, by name.
  createProxyHandler({ dangerouslyAllowAnyRequest: true });

  try {
    throw new HoneytongueError("example");
  } catch (err) {
    if (err instanceof StoryError) expectType<string[]>(err.problems);
    if (err instanceof HoneytongueError) {
      expectType<number | undefined>(err.status);
      if (err.reason === "version") expectType<string | null | undefined>(err.proxyVersion);
    }
  }
  return response;
}

function subpaths() {
  // The subpaths export the same things as the main entry point.
  exact<typeof persuasion.Persuadable, typeof Persuadable>(true);
  exact<typeof persuasion.judgePersuasion, typeof judgePersuasion>(true);
  exact<typeof persuasion.DEFAULT_LEVELS, typeof DEFAULT_LEVELS>(true);
  exact<SubpathCharacter, Character>(true);
  exact<SubpathClient, JevClient>(true);
  exact<typeof subpathHandler, typeof createProxyHandler>(true);
  exact<SubpathOptions, ProxyHandlerOptions>(true);
  exact<SubpathEnv, ProxyEnv>(true);
  // @ts-expect-error: the persuasion entry point doesn't include the engine
  persuasion.Game;
  // @ts-expect-error: or the clients
  persuasion.createJevClient;
}

export { persuasionApi, engineApi, clientsAndProxy, subpaths };
