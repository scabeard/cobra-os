/**
 * Scope guard — the authorization boundary.
 *
 * Every network-touching tool validates its target against COBRA_ALLOWED_SCOPE
 * (comma-separated CIDRs and domains). Empty scope = deny everything.
 * This is enforced in code, not requested.
 */
import { CONFIG } from "./config.js";

interface ScopeEntry {
  kind: "cidr" | "domain" | "ip" | "onion";
  raw: string;
  // for cidr/ip
  base?: bigint;
  bits?: number;
  prefix?: bigint;
}

let parsed: ScopeEntry[] | null = null;

function ipToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let acc = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    acc = (acc << 8n) | BigInt(n);
  }
  return acc;
}

function parseScope(raw: string): ScopeEntry[] {
  const out: ScopeEntry[] = [];
  for (const token of raw.split(",")) {
    const t = token.trim();
    if (!t) continue;
    if (t.includes("/")) {
      const [baseIp, bitsStr] = t.split("/");
      const base = ipToBigInt(baseIp);
      const bits = Number(bitsStr);
      if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const hostBits = 32n - BigInt(bits);
      const prefix = hostBits >= 32n ? 0n : (base >> hostBits) << hostBits;
      out.push({ kind: "cidr", raw: t, base, bits, prefix });
    } else if (ipToBigInt(t) !== null) {
      out.push({ kind: "ip", raw: t, base: ipToBigInt(t)! });
    } else if (t.toLowerCase() === ".onion") {
      // Wildcard: any .onion host. Phase 5 — an onion address isn't a CIDR or
      // a normal domain, so it gets its own entry kind.
      out.push({ kind: "onion", raw: t.toLowerCase() });
    } else {
      out.push({ kind: "domain", raw: t.toLowerCase() });
    }
  }
  return out;
}

function entries(): ScopeEntry[] {
  if (parsed === null) parsed = parseScope(CONFIG.allowedScopeRaw);
  return parsed;
}

/** Re-parse scope (e.g. if config changed at runtime). */
export function reloadScope(): void {
  parsed = null;
}

function ipInCidr(ip: bigint, e: ScopeEntry): boolean {
  const hostBits = 32n - BigInt(e.bits!);
  const ipPrefix = hostBits >= 32n ? 0n : (ip >> hostBits) << hostBits;
  return ipPrefix === e.prefix;
}

function domainMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  return h === domain || h.endsWith("." + domain);
}

/**
 * Returns true if the target (IP or hostname) is within the allowed scope.
 * Empty scope = deny all.
 */
export function inScope(target: string): boolean {
  const list = entries();
  if (list.length === 0) return false;
  const ip = ipToBigInt(target);
  for (const e of list) {
    if (ip !== null) {
      if (e.kind === "ip" && e.base === ip) return true;
      if (e.kind === "cidr" && ipInCidr(ip, e)) return true;
    }
    if (e.kind === "domain" && domainMatches(target, e.raw)) return true;
    if (e.kind === "onion" && target.toLowerCase().endsWith(".onion")) return true;
  }
  return false;
}

/** Throw if target is out of scope. */
export function assertInScope(target: string): void {
  if (!inScope(target)) {
    throw new Error(
      `SCOPE VIOLATION: target "${target}" is outside COBRA_ALLOWED_SCOPE. ` +
        `Refusing to run. Add it to the scope only if you have explicit authorization.`
    );
  }
}

/** Human-readable current scope (for opshelp / diagnostics). */
export function scopeSummary(): string {
  const list = entries();
  if (list.length === 0) return "(empty — all targets refused)";
  return list.map((e) => e.raw).join(", ");
}
