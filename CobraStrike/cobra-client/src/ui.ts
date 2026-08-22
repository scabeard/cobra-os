/**
 * Minimal terminal UI — banner, colored status lines, and a spinner.
 * No external deps; ANSI only, and degrades cleanly when not a TTY.
 */
const isTTY = process.stdout.isTTY;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function paint(color: keyof typeof C, s: string): string {
  if (!isTTY || color === "reset") return s;
  return `${C[color]}${s}${C.reset}`;
}

export const ui = {
  banner(model: string): void {
    const art = [
      "   ____      _                ____  _        _ _        ",
      "  / ___|___ | |__  _ __ __ _ / ___|| |_ _ __(_) | _____ ",
      " | |   / _ \\| '_ \\| '__/ _` |\\___ \\| __| '__| | |/ / _ \\",
      " | |__| (_) | |_) | | | (_| | ___) | |_| |  | |   <  __/",
      "  \\____\\___/|_.__/|_|  \\__,_||____/ \\__|_|  |_|_|\\_\\___|",
    ].join("\n");
    process.stdout.write(paint("green", art) + "\n");
    process.stdout.write(paint("dim", `  headless MCP client  •  model: ${model}\n\n`));
  },
  info: (s: string) => process.stdout.write(paint("cyan", "ℹ ") + s + "\n"),
  ok: (s: string) => process.stdout.write(paint("green", "✔ ") + s + "\n"),
  warn: (s: string) => process.stdout.write(paint("yellow", "⚠ ") + s + "\n"),
  err: (s: string) => process.stdout.write(paint("red", "✖ ") + s + "\n"),
  tool: (name: string, args: Record<string, unknown>) => {
    const argStr = Object.entries(args)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    process.stdout.write(paint("magenta", `\n▶ ${name}`) + paint("dim", ` ${argStr}\n`));
  },
  toolResult: (result: string) => {
    const lines = result.split("\n");
    const head = lines.slice(0, 6).join("\n");
    const more = lines.length > 6 ? paint("dim", `\n  … ${lines.length - 6} more lines`) : "";
    process.stdout.write(paint("dim", head) + more + "\n");
  },
  assistant: (text: string) => {
    process.stdout.write("\n" + paint("bold", "🐍 cobra") + paint("dim", " › ") + text + "\n");
  },
  usage: (tokens: number, turn: number) => {
    if (isTTY) {
      process.stdout.write(paint("dim", `  [turn ${turn} • ${tokens} tokens]`));
    }
  },
};

export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private label: string;

  constructor(label: string) {
    this.label = label;
  }

  start(): void {
    if (!isTTY) return;
    this.timer = setInterval(() => {
      const f = this.frames[this.i++ % this.frames.length];
      process.stdout.write(`\r${paint("cyan", f)} ${this.label}`);
    }, 80);
  }

  stop(final?: string): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (isTTY) process.stdout.write("\r\x1b[K");
    if (final) process.stdout.write(final + "\n");
  }
}
