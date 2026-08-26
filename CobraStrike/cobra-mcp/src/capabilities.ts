/**
 * Capability probe — detects which OS tools exist on the runtime box at startup.
 * The runtime OS differs from the dev machine, so we probe rather than assume.
 * Reports what's missing + which package provides it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface Capability {
  binary: string;
  present: boolean;
  path?: string;
  /** package that provides it (debian/kali) */
  pkg: string;
  /** brew package (macOS) */
  brew?: string;
}

/** binary → [debian pkg, brew pkg?] */
const TOOL_MAP: Record<string, [string, string?]> = {
  nmap: ["nmap", "nmap"],
  dig: ["dnsutils", "bind"],
  whois: ["whois", "whois"],
  ffuf: ["ffuf", "ffuf"],
  gobuster: ["gobuster", "gobuster"],
  nikto: ["nikto", "nikto"],
  sqlmap: ["sqlmap", "sqlmap"],
  hydra: ["hydra", "hydra"],
  john: ["john", "john-jumbo"],
  hashcat: ["hashcat", "hashcat"],
  searchsploit: ["exploitdb", "exploitdb"],
  tcpdump: ["tcpdump", "tcpdump"],
  tshark: ["tshark", "wireshark"],
  nc: ["netcat-openbsd", "netcat"],
  socat: ["socat", "socat"],
  ssh: ["openssh-client", "openssh"],
  sshpass: ["sshpass", "sshpass"],
  proxychains4: ["proxychains4", "proxychains-ng"],
  tor: ["tor", "tor"],
  "gs-netcat": ["gsocket (static build via cobrashell `bin gs-netcat`)", "gsocket"],
  python3: ["python3", "python3"],
  curl: ["curl", "curl"],
  wget: ["wget", "wget"],
  perl: ["perl", "perl"],
  git: ["git", "git"],
};

let cache: Capability[] | null = null;

async function which(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("sh", ["-c", `command -v ${binary}`]);
    const p = stdout.trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

export async function probeCapabilities(): Promise<Capability[]> {
  const out: Capability[] = [];
  for (const [binary, [pkg, brew]] of Object.entries(TOOL_MAP)) {
    const p = await which(binary);
    out.push({ binary, present: p !== null, path: p ?? undefined, pkg, brew });
  }
  cache = out;
  return out;
}

export function getCapabilities(): Capability[] {
  return cache ?? [];
}

export function hasCapability(binary: string): boolean {
  return (cache ?? []).some((c) => c.binary === binary && c.present);
}

export function capabilityPath(binary: string): string | null {
  const c = (cache ?? []).find((c) => c.binary === binary && c.present);
  return c?.path ?? null;
}

/** Throw if a required binary is missing, with an install hint. */
export function requireCapability(binary: string): string {
  const p = capabilityPath(binary);
  if (!p) {
    const c = (cache ?? []).find((c) => c.binary === binary);
    const hint = c
      ? `Install with: apt install ${c.pkg}` + (c.brew ? `  (macOS: brew install ${c.brew})` : "")
      : `Install the '${binary}' tool.`;
    throw new Error(`MISSING TOOL: '${binary}' not found on this box. ${hint}`);
  }
  return p;
}

/** Render capabilities as a markdown table (for the cobra://capabilities resource). */
export function capabilitiesMarkdown(): string {
  const list = getCapabilities();
  if (list.length === 0) return "_capabilities not yet probed_";
  const rows = list.map(
    (c) =>
      `| ${c.binary} | ${c.present ? "✅" : "❌"} | ${c.path ?? "—"} | ${c.pkg} | ${c.brew ?? "—"} |`
  );
  return [
    "# Runtime Capabilities",
    "",
    "| Binary | Present | Path | Debian pkg | Brew pkg |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
