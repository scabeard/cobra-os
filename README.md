# COBRA OS 🐍

A minimal, hardened **red team live OS** scaffold: Debian trixie
`minbase` + Parrot OS repos for the tool feed, a rebranded operator shell
(cobrashell, forked from THC's hackshell), and the cobra-ops command
registry (the retired Textual TUI, ported to bash functions). **Console-only
by design** — no X server, no display manager, no GUI packages. tmux splits
are the dashboard; `links2` (optionally over Tor) is the browser.
For authorized engagements only.

This is a scaffold, not a finished distro — treat every default (passwords,
tool list, firewall rules) as something to review before it touches a
network you care about. See **BUILD_PLAN.md** for the full architecture,
tool-selection rationale, extras mechanism, and live-ISO path.

## Layout

```
build-rootfs.sh            host-side: debootstrap + stages COBRA files into the chroot
chroot-setup.sh            runs inside the chroot: Parrot repo, tools, shell, hardening
build-iso.sh               host-side: live-build ISO (chroot hook reuses chroot-setup.sh)
shell/cobrashell.sh        operator shell (no history, RAM-only XHOME, anti-forensics)
shell/ghostip.sh           vendored THC ghost-IP tool (sources locally — no network needed)
shell/whatserver.sh        vendored THC whatserver tool (runs locally — no network at all)
shell/mkegg.sh             vendored THC egg maker (self-extracting payload packer)
shell/upload_server.php    vendored THC upload server (loot drops; php-cli = webplus)
shell/linpeas.sh           vendored PEASS-ng linpeas (local privesc enum — no network)
shell/cobra-ops.sh         operator command registry (the retired TUI, ported to bash)
shell/cobra-theme.sh       console theme: VGA palette, LS_COLORS, less/grep colors
splash.png                 boot splash (640x480, flattened from Cobras-OS.png)
BUILD_PLAN.md              decisions, tool table, profiles, hardening, live-ISO plan
CobraStrike/               self-contained headless AI operator (cobra-mcp + cobra-client)
website/                   cobra-os.com static site (Cloudflare Pages for the clearnet
                           brochure + /shell/ + /cobra/ mirrors; the ISO and gs-netcat
                           binaries ship ONLY from the .onion service over Tor — see
                           website/README.md)
```

## 1. Build the rootfs

Run on a Debian/Ubuntu host (or VM — debootstrap wants root):

```bash
sudo apt install debootstrap
sudo ./build-rootfs.sh                                   # core toolset
sudo COBRA_PROFILES="wireless exploit" ./build-rootfs.sh # with extras
sudo SKIP_DEBOOTSTRAP=1 ./build-rootfs.sh                # resume on a warm rootfs
```

Produces `./rootfs/`: minimal Debian base + Parrot repo, the curated core
tool set, locked root, an `operator` sudo user (password `changeme` —
tty1 console autologin, forced replacement on first login), default-deny nftables firewall,
sysctl/modprobe hardening, MAC randomization, and history-off defaults.

**Console-only.** The brief X11/i3/Terminator + Firefox/Tor Browser layer
(2026-08-15/16) is reverted — nothing in the image needs `startx`, and GUI
packages are actively purged from warm chroots on rebuild. Web access is a
text browser over deliberate, gated connections (see §5).

The Parrot feed defaults to the rolling `parrot` suite (currently codename
`echo`, Parrot 7 — trixie-built, which is why the base is trixie, not
bookworm). The old `lory` suite is frozen (stub indexes only). Check
`deb.parrot.sh/parrot/dists/` before builds; override with
`PARROT_SUITE=<suite> ./build-rootfs.sh`.

## 2. Build the live ISO

`build-iso.sh` drives `live-build` but reuses the exact same
`chroot-setup.sh` as a chroot hook — one source of truth for the toolset
and hardening:

```bash
sudo apt install live-build
sudo ./build-iso.sh                                  # core toolset ISO
sudo COBRA_PROFILES="wireless" ./build-iso.sh        # with extras
sudo COBRA_PROFILES="ai" ./build-iso.sh              # bake in the CobraStrike AI operator
```

> **`COBRA_PROFILES=ai`** bakes the CobraStrike AI operator into the image at
> build time (managed `nodejs` + the pre-built `cobra.js`/`cobra-mcp.js` bundles
> in `/etc/cobra/`, system launcher `/usr/local/bin/cobra`, and a `cobra`
> operator command). No runtime `curl | bash`, no PATH fiddling — `cobra run
> "<task>"` works on first login after `xint` and `cobra setup --save-key`
> (your own OpenRouter key, stored 0600). The core build stays Node-free; the
> generic site `install.sh` remains for non-COBRA boxes. The bundles are staged
> from `CobraStrike/*/dist/` — run `npm run bundle` in each if they're stale.

Produces `cobra-os-<date>.iso` (+ `.sha256`): iso-hybrid (BIOS+UEFI),
live-boot with `noswap persistence` on the cmdline, LUKS persistence
unlock via cryptsetup, live-config purged (operator/hostname are baked,
not generated at boot). `toram` stays a TAB-edit at the boot menu. Boot
params, the LUKS persistence-stick recipe, and design rationale:
BUILD_PLAN.md §5.

The boot menu is themed: `splash.png` (the cobra from `Cobras-OS.png`,
flattened for vesamenu) backs both the isolinux (BIOS) and GRUB (UEFI)
menus, with neon-red-on-black menu colors — see §6 below.

Smoke test (no /dev/kvm needed, just slower):

```bash
qemu-system-x86_64 -m 2G -cdrom cobra-os-*.iso
```

Quick rootfs test meanwhile: `sudo chroot ./rootfs /bin/bash`

## 3. The shell — cobrashell

Installed to `/etc/cobra/cobrashell.sh`, auto-sourced for interactive bash
(`HUSH=1` fast mode; `COBRA_SHELL_OFF=1` to opt out). Not booted into COBRA
OS? The same file is mirrored on the project site —
`source <(curl -fsSL https://cobra-os.com/shell/cobrashell.sh)` loads it on
any box (helpers at `/shell/`, gs-netcat from the `.onion` over Tor). Highlights:

- no history anywhere, XHOME in `/dev/shm`, auto-destructs on exit
- `loot` / `lootmore` — secrets & situational awareness on a target
- `scan`, `xssh`, `bounce`, `ghostip`, `hide`, `memexec`, `enc`/`dec`
- `xtmux` — tmux over a hidden socket (won't show in `tmux ls`)
- anything touching the internet requires `xint` first — `dl`,
  `transfer`/`tb` (paste-site exfil), `ipinfo`, the `gs-*` gsocket tools,
  and `loot`'s cloud-metadata checks are all gated (we closed upstream's
  gaps), plus `web` (text browser, see §5)
- de-THC'd: upstream's `sub`/`ptr` recon calls to `ip.thc.org` are removed
  (engagement targets must not leak to third-party infra). Set
  `COBRA_RECON_HOST` to point them at your own recon service;
  `GS_HOST`/`GS_PORT` point the `gs-*` tools at a relay you trust
  (relay.cobra-os.com runs on our VPS — or run your own); `bin gs-netcat`
  fetches the static binary from our `.onion` over Tor, not THC's GitHub
- `ws` runs the vendored `/etc/cobra/whatserver.sh` — no network, no remote
  sourcing (its upstream ipinfo.io lookup is stripped; use `ipinfo`)

**Target-side only — do NOT run these on the COBRA box itself:**
`ttyinject` (backdoors the local user's `~/.bashrc`), `lpe` (downloads AND
executes PEAS code from GitHub — for THIS box use cobra-ops `privesc`,
which runs the vendored linpeas locally), `clean`/`sshd_clean`,
`utmp_clean`/`wtmp_trim`/`btmp_trim`/`lastlog_clean`, `xlog`, `hide`,
`zapme`, `notime`/`ctime`/`notime_cp`. The `ssh` wrapper also enables legacy
ciphers for target compatibility — `export SSH_NO_OLD=1` to disable.

## 4. The registry — cobra-ops

The retired Textual TUI's command set, ported to bash functions (sourced
in every interactive bash shell). `opshelp` lists them (`stop` is a legacy
no-op — Ctrl+C in the tool's own pane is the real stop):

- **recon**: `target`, `fscan`, `portscan`, `svcscan`, `vulnscan`,
  `udpscan`, `whois`, `dnsq`, `smbenum` (`fscan`/`dnsq` renamed to avoid
  cobrashell's own `scan`/`dns`)
- **web**: `webdir`, `webvuln`, `sql`
- **creds**: `brute`, `crack`, `hashcrack`
- **exploit lookup / local privesc**: `sploit` (offline searchsploit —
  the exploit-db CSV lives on disk), `privesc` (vendored linpeas on THIS
  box — no network; cobrashell's `lpe` is the target-side variant)
- **capture/listeners**: `sniff`, `pcap`, `listen`, `serve` — run each in
  its own tmux pane; Ctrl+C stops it
- **payload & exfil**: `egg` (wizard: pack payloads into a self-extracting
  archive; with args it's a scriptable mkegg.sh passthrough), `upserv`
  (wizard: PHP loot-drop receiver — needs the `webplus` profile; offers an
  nftables input hole when binding off-loopback)
- **dashboards**: `mon` (btop), `files` (nnn), `web` (links2 — see §5)

The dashboard is **tmux**: split panes (`Ctrl+b "` / `Ctrl+b %`), one tool
per pane, `mon`/`files`/`web` where you want them. No X, no panels, no
compositor — a TTY is all you get, and all you need.

Every function maps 1:1 to a package in `chroot-setup.sh` and a row in
BUILD_PLAN.md §2 — keep them in sync.

## 5. Web — console-only, Tor-capable

There is no GUI browser. Web access is deliberate, gated, and text-mode:

- `web [url]` → `links2`, gated by cobrashell's `xint` (same
  deliberate-internet philosophy as `transfer`/`tb`). Loopback URLs stay
  open without `xint` for local listeners (e.g. browsing `upserv` loot).
- Over Tor: `xint`, then `torify links2 <url>` — torsocks wraps the
  links2 binary against the system tor daemon (SOCKS `127.0.0.1:9050`).
  Note: `torify` cannot wrap the `web` shell function — call `links2`
  directly for the Tor path.
- `proxy 9050` (cobrashell) exports socks5h proxy env vars for curl & co;
  `proxychains4` is in the core toolset for anything else.

## 6. The theme — red-team cyberpunk, no X

The whole boot-to-shell path is themed, with zero packages and zero X:

- **boot menu**: cobra splash + neon-red menus (isolinux BIOS and GRUB
  UEFI on the ISO; a `grub.d` drop-in themes grub-pc on rootfs builds)
- **login prompt**: red ASCII cobra banner in `/etc/issue`
- **console**: `cobra-theme.sh` remaps the TTY's 16-color VGA palette to
  the COBRA neon ramp (cobrashell's prompt goes red/cyan/violet
  automatically), plus themed `LS_COLORS`, grep matches and man pages
- **opshelp**: the operator help screen itself renders in the ramp —
  neon-red section headers, phosphor-green commands, amber gotchas,
  gunmetal parentheticals (reuses cobrashell's color vars; plain when
  piped)
- **tmux**: `/etc/tmux.conf` — black status bar, neon-red active
  tab/pane border, cyan clock

Opt out per shell with `export COBRA_THEME_OFF=1`. Palette values and
mechanics: BUILD_PLAN.md §6.

## Change before deploying

- `changeme` in `chroot-setup.sh` (scaffold default — see BUILD_PLAN.md §7)
- review `PARROT_SUITE`, the core tool list, and nftables rules
