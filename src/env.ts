// Load ./.env if present, so `npm start`, `npm run cli` and `npm run eval` pick up API keys on any
// shell (PowerShell has no `source`). Variables already set in the environment win over the file.
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch (e) {
    console.warn(`Could not read .env: ${(e as Error).message}`);
  }
}
