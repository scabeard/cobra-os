/**
 * Secure OpenRouter key handling.
 *
 * Priority:
 *   1. --api-key / OPENROUTER_API_KEY already in the environment (CI / headless)
 *   2. Interactive hidden prompt (no echo) — never persisted unless the user
 *      explicitly opts in via `cobra setup --save-key`.
 *
 * If the user opts to save, the key is stored at ~/.config/cobra/credentials
 * with mode 0600. It is still never printed back out.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

function credFile(): string {
  return path.join(os.homedir(), ".config", "cobra", "credentials");
}

/** Read a saved key (0600 file). Returns undefined if absent. */
export function readSavedKey(): string | undefined {
  try {
    const raw = fs.readFileSync(credFile(), "utf8");
    const m = raw.match(/^OPENROUTER_API_KEY=(.+)$/m);
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Persist the key with restrictive permissions (opt-in only). */
export function saveKey(key: string): string {
  const dir = path.dirname(credFile());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(credFile(), `OPENROUTER_API_KEY=${key}\n`, { mode: 0o600 });
  return credFile();
}

/** Delete any saved key. */
export function clearKey(): boolean {
  try {
    fs.unlinkSync(credFile());
    return true;
  } catch {
    return false;
  }
}

/** Prompt for the key without echoing input. */
export function promptKeyHidden(question = "OpenRouter API key: "): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Mute echo by swapping the output write.
    const out = (rl as unknown as { _writeToOutput?: (s: string) => void });
    const orig = out._writeToOutput?.bind(rl);
    if (out._writeToOutput && orig) {
      out._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(s);
        else process.stdout.write("*");
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      const k = answer.trim();
      if (!k) reject(new Error("empty API key"));
      else resolve(k);
    });
  });
}

/**
 * Resolve the key from (in order): explicit value, env var, saved file, or
 * interactive prompt. Never logs the key.
 */
export async function resolveApiKey(opts: {
  explicit?: string;
  allowPrompt?: boolean;
}): Promise<{ key: string; source: string }> {
  if (opts.explicit) return { key: opts.explicit, source: "flag" };
  const env = process.env.OPENROUTER_API_KEY;
  if (env) return { key: env, source: "env" };
  const saved = readSavedKey();
  if (saved) return { key: saved, source: "saved" };
  if (opts.allowPrompt !== false && process.stdin.isTTY) {
    const key = await promptKeyHidden();
    return { key, source: "prompt" };
  }
  throw new Error(
    "No OpenRouter API key. Set OPENROUTER_API_KEY, pass --api-key, run `cobra setup`, or use an interactive shell."
  );
}
