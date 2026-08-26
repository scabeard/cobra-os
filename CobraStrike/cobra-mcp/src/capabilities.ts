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
  /* --- profile binaries (Phase 6): probed so profile_check can report --- */
  bettercap: ["bettercap (profile: wireless)", "bettercap"],
  hcxdumptool: ["hcxdumptool (profile: wireless)", "hcxdumptool"],
  reaver: ["reaver (profile: wireless)", "reaver"],
  bully: ["bully (profile: wireless)", "bully"],
  kismet: ["kismet (profile: wireless)", "kismet"],
  airodump: ["aircrack-ng (profile: wireless)", "aircrack-ng"],
  impacket: ["python3-impacket + impacket-scripts (profile: ad)", "impacket"],
  responder: ["responder (profile: ad)", "responder"],
  netexec: ["netexec (profile: ad)", "netexec"],
  nxc: ["netexec (profile: ad)", "netexec"],
  bloodhound: ["bloodhound.py (profile: ad)", "bloodhound"],
  msfconsole: ["metasploit-framework (profile: exploit)", "metasploit"],
  wpscan: ["wpscan (profile: webplus)", "wpscan"],
  mitmproxy: ["mitmproxy (profile: webplus)", "mitmproxy"],
};

/**
 * COBRA_PROFILES cases (Phase 6) — the OS-side optional tool groups, mirrored
 * here so the agent can discover what's available and what to ask the operator
 * to rebuild with. `ai` is a build-time profile (bundles + launcher), not a
 * runtime tool set, so it isn't listed. Packages match chroot-setup.sh.
 */
export const PROFILE_MAP: Record<string, { desc: string; binaries: string[]; packages: string; note?: string }> = {
  wireless: {
    desc: "Wireless assessment (802.11 + WPS)",
    binaries: ["bettercap", "hcxdumptool", "reaver", "bully", "kismet", "airodump"],
    packages: "bettercap hcxtools hcxdumptool reaver bully kismet aircrack-ng",
    note: "Needs a wireless adapter + monitor mode; usually run on the operator box, not the target.",
  },
  ad: {
    desc: "Active Directory (impacket, responder, netexec, bloodhound)",
    binaries: ["impacket", "responder", "netexec", "nxc", "bloodhound"],
    packages: "python3-impacket impacket-scripts responder netexec bloodhound.py",
    note: "Scope-gate every DC/KDC target; responder/netexec are LOUD on the wire.",
  },
  exploit: {
    desc: "Metasploit framework (msfconsole)",
    binaries: ["msfconsole"],
    packages: "metasploit-framework",
    note: "searchsploit/exploitdb is CORE (offline); this profile adds msf only. Heavy.",
  },
  webplus: {
    desc: "Web extras (wpscan, mitmproxy, seclists)",
    binaries: ["wpscan", "mitmproxy"],
    packages: "mitmproxy ffuf seclists wpscan php-cli",
    note: "ffuf is already core; this adds wpscan + mitmproxy (TTY proxy) + seclists wordlists.",
  },
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

/* --- Phase 6: profile wrappers -------------------------------------------- */

export interface ProfileStatus {
  name: string;
  desc: string;
  packages: string;
  note?: string;
  installed: string[];
  missing: string[];
  /** true when at least one of the profile's binaries is present */
  partial: boolean;
  /** true when every binary is present */
  full: boolean;
}

/** Read-only probe of each COBRA_PROFILES case against the probed cache. */
export function probeProfiles(): ProfileStatus[] {
  return Object.entries(PROFILE_MAP).map(([name, p]) => {
    const installed = p.binaries.filter((b) => hasCapability(b));
    const missing = p.binaries.filter((b) => !hasCapability(b));
    return {
      name,
      desc: p.desc,
      packages: p.packages,
      note: p.note,
      installed,
      missing,
      partial: installed.length > 0,
      full: missing.length === 0,
    };
  });
}

/** One profile by name, or undefined. */
export function profileStatus(name: string): ProfileStatus | undefined {
  return probeProfiles().find((p) => p.name === name);
}

/** Markdown table of profile availability (appended to cobra://capabilities). */
export function profilesMarkdown(): string {
  const rows = probeProfiles().map(
    (p) =>
      `| ${p.name} | ${p.full ? "✅ full" : p.partial ? "🟡 partial" : "❌ absent"} | ${p.installed.join(", ") || "—"} | ${p.missing.join(", ") || "—"} |`
  );
  return [
    "",
    "## COBRA_PROFILES (OS tool groups)",
    "",
    "| Profile | Status | Installed | Missing |",
    "|---|---|---|---|",
    ...rows,
    "",
    "_Rebuild the OS with `COBRA_PROFILES=\\\"<name>\\\"` to add a missing group. Profiles are never auto-installed._",
  ].join("\n");
}
