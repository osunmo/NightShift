#!/usr/bin/env node
// Runs the TypeScript CLI through tsx so no build step is needed.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["--no-warnings", "--import", "tsx", join(root, "src/cli.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGINT", () => child.kill("SIGINT"));
