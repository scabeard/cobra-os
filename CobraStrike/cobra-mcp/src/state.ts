/**
 * Server-side engagement state: active target + session registry.
 * Persisted in-memory per server process.
 */

export interface SessionInfo {
  id: string;
  kind: "listen" | "sniff" | "pcap" | "upserv" | "serve";
  pid: number;
  started: string;
  /** human description, e.g. "nc -lvnp 4444" */
  desc: string;
  /** path to the file capturing output */
  outputFile: string;
}

let activeTarget: string | null = null;
const sessions = new Map<string, SessionInfo>();
let sessionCounter = 0;

export function setTarget(t: string): void {
  activeTarget = t;
}

export function getTarget(): string | null {
  return activeTarget;
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
