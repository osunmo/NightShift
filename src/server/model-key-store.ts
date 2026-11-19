import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = 1;
const aad = Buffer.from("nightshift:model-keys:v1");

function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function windowsProtect(key: Buffer, operation: "Protect" | "Unprotect"): Buffer {
  const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$result = [System.Security.Cryptography.ProtectedData]::${operation}($inputBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Write([Convert]::ToBase64String($result))`;
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: key.toString("base64"),
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Windows could not access the Nightshift model encryption key.");
  }
  return Buffer.from(result.stdout.trim(), "base64");
}

export function createModelKeyStore(home: string) {
  const file = join(home, "model-keys.json");
  const keyFile = join(home, ".model-keys-master");
  let master: Buffer | undefined;

  function writeTemporary(contents: string, publish: (temporary: string) => void) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const temporary = join(home, `.model-keys-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" });
      publish(temporary);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  function getMaster(create: boolean) {
    if (master) return master;
    const windows = process.platform === "win32";
    let encoded = readOptional(keyFile);
    if (encoded === undefined && create) {
      const generated = randomBytes(32);
      const protectedKey = windows ? windowsProtect(generated, "Protect") : generated;
      const value = protectedKey.toString("base64");
      try {
        // Publish once, without replacing another process's existing encryption key.
        writeTemporary(value, (temporary) => linkSync(temporary, keyFile));
        encoded = value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        encoded = readOptional(keyFile);
      }
    }
    if (encoded === undefined) throw new Error("Nightshift's model encryption key is missing.");
    const bytes = Buffer.from(encoded, "base64");
    const key = windows ? windowsProtect(bytes, "Unprotect") : bytes;
    if (key.length !== 32) throw new Error("Nightshift's model encryption key is invalid.");
    master = key;
    return master;
  }

  return {
    load(): { value: unknown; legacy: boolean } {
      const raw = readOptional(file);
      if (raw === undefined) return { value: {}, legacy: false };
      const envelope = JSON.parse(raw);
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !Object.hasOwn(envelope, "version")) {
        return { value: envelope, legacy: true };
      }
      if (envelope.version !== version || [envelope.iv, envelope.tag, envelope.ciphertext].some((part) => typeof part !== "string")) {
        throw new Error("Invalid encrypted model key store.");
      }
      const iv = Buffer.from(envelope.iv, "base64");
      const tag = Buffer.from(envelope.tag, "base64");
      if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted model key store.");
      const decipher = createDecipheriv("aes-256-gcm", getMaster(false), iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const ciphertext = Buffer.from(envelope.ciphertext, "base64");
      const cleartext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return { value: JSON.parse(cleartext.toString("utf8")), legacy: false };
    },
    save(value: object) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", getMaster(true), iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      const contents = JSON.stringify({
        version,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      });
      writeTemporary(contents, (temporary) => renameSync(temporary, file));
    },
  };
}
