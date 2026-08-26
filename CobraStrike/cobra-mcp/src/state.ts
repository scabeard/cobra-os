/**
 * Server-side engagement state: active target + session registry.
 * Persisted in-memory per server process.
 */

export interface SessionInfo {
  id: string;
  kind: "listen" | "sniff" | "pcap" | "upserv" | "serve" | "tunnel";
  pid: number;
  started: string;
  /** human description, e.g. "nc -lvnp 4444" */
  desc: string;
  /** path to the file capturing output */
  outputFile: string;
}

/** A live SOCKS tunnel into a foothold's network (ssh -D / gs-netcat -p). */
export interface TunnelInfo {
  /** same id as the backing session */
  id: string;
  /** local loopback port the SOCKS listener sits on */
  port: number;
  socksVersion: 4 | 5;
  /** foothold description, e.g. "user@192.168.56.101" */
  via: string;
}

/**
 * Multi-target registry (Phase 7). `activeTarget` is the most recently set
 * target (backward compatible with the single-target API); `targets` is the
 * full engagement set, most-recent-first. Concurrent targets are first-class:
 * recon on one foothold doesn't clobber the operator's focus on another.
 */
let activeTarget: string | null = null;
const targets: string[] = [];
const sessions = new Map<string, SessionInfo>();
let sessionCounter = 0;

export function setTarget(t: string): void {
  activeTarget = t;
  const i = targets.indexOf(t);
  if (i !== -1) targets.splice(i, 1);
  targets.unshift(t); // most-recent-first
}

export function getTarget(): string | null {
  return activeTarget;
}

/** All registered targets, most-recent-first. */
export function listTargets(): string[] {
  return [...targets];
}

/** Remove a target; clears activeTarget if it was the active one. */
export function removeTarget(t: string): boolean {
  const i = targets.indexOf(t);
  if (i === -1) return false;
  targets.splice(i, 1);
  if (activeTarget === t) activeTarget = targets[0] ?? null;
  return true;
}

/** Drop all targets. */
export function clearTargets(): void {
  targets.length = 0;
  activeTarget = null;
}

export function nextSessionId(kind: string): string {
  sessionCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${sessionCounter}`;
}

export function registerSession(s: SessionInfo): void {
  sessions.set(s.id, s);
}

export function getSession(id: string): SessionInfo | undefined {
  return sessions.get(id);
}

export function removeSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()];
}

/* --- Tunnel registry (keyed by session id) --- */

const tunnels = new Map<string, TunnelInfo>();

export function registerTunnel(t: TunnelInfo): void {
  tunnels.set(t.id, t);
}

/** Look up a tunnel by id; no arg = the most recently registered one. */
export function getTunnel(id?: string): TunnelInfo | undefined {
  if (id) return tunnels.get(id);
  const all = [...tunnels.values()];
  return all.length > 0 ? all[all.length - 1] : undefined;
}

export function removeTunnel(id: string): boolean {
  return tunnels.delete(id);
}

export function listTunnels(): TunnelInfo[] {
  return [...tunnels.values()];
}

/* --- Beacon registry (gs-netcat C2, keyed by beacon id) --- */

/** A gs-netcat beacon deployed on a foothold. The SECRET is never stored in
 *  state — only a correlation label and the path to the 0600 keyfile. */
export interface BeaconInfo {
  id: string;
  /** beacon personality: shell (-l -e bash) | socks (-l -S) | login (-l -i) */
  mode: "shell" | "socks" | "login";
  /** where it was deployed, e.g. "user@192.168.56.101" or "manual one-liner" */
  where: string;
  started: string;
  /** correlation label: first 4 chars of the secret + "…" */
  label: string;
  /** keyfile (0600, in loot keys/) holding the secret, used with gs-netcat -k */
  keyFile: string;
  /** exact remote cleanup command (kill beacon + watchdog, remove staged binary) */
  cleanup: string;
}

const beacons = new Map<string, BeaconInfo>();

export function registerBeacon(b: BeaconInfo): void {
  beacons.set(b.id, b);
}

export function getBeacon(id: string): BeaconInfo | undefined {
  return beacons.get(id);
}

export function removeBeacon(id: string): boolean {
  return beacons.delete(id);
}

export function listBeacons(): BeaconInfo[] {
  return [...beacons.values()];
}
