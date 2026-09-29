// The TypeSafe key for live Jev runs lives in .env.live at the repository root (git-ignored, never packed), not in
// the machine's environment, so programs that don't need it (browsers, editors, crash reports) never see it. Scripts
// that call Jev load it with loadLiveEnv(); the npm scripts for the CLI, the example, the proxy, and the playground
// load it with node --env-file-if-exists=.env.live. Nothing else does.
//
//   .env.live:   TYPESAFE_API_KEY=your-key
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LIVE_ENV_FILE = fileURLToPath(new URL("../.env.live", import.meta.url));

/** Load .env.live into this process, unless the key is already set here. Returns whether a key is now set. */
export function loadLiveEnv() {
  if (!process.env.TYPESAFE_API_KEY && existsSync(LIVE_ENV_FILE)) process.loadEnvFile(LIVE_ENV_FILE);
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}
