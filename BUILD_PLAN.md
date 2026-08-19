# COBRA OS — build plan & decision log

> **2026-08-19: review fix pass.** Full-tree audit (bash -n + shellcheck +
> runtime probes). Real bugs fixed: (1) cobrashell `gs-sftp()` had a
> missing-space test (`[ -z "$GSNC"]`) that printed `[: missing ]` on every
> run with gs-netcat present. (2) `build-iso.sh` silently dropped the
> `OPERATOR_USER`/`COBRA_HOSTNAME` knobs `build-rootfs.sh` honors — the
> hook now bakes all four (and quotes `PARROT_SUITE`). (3) The vendored
> `upload_server.php` router never returned false, so `upserv`'s advertised
> loot browsing could list but never serve files — cli-server fallback
> added (+ https→http wording; `php -S` is plaintext). (4)
> `build-rootfs.sh` copied the host's resolv.conf verbatim — a
> systemd-resolved 127.0.0.53 stub is dead inside the chroot; the resolved
> upstream servers are preferred when the stub is detected. Vendored
> cleanups (header-noted): dead `HS_URL` check in `ssh()`, empty `$str` in
> lootlight's ACTIVE line, `_LS_LOOT_PCT` typo, whatserver's dead `$ptrcn`
> addcn + res/arr check. Housekeeping: rockyou.txt.gz is no longer kept
> after gunzip (~60 MB off the image); `iputils-ping` + `strace` join
> BASE_PKGS (ghostip.sh/linpeas and cobrashell `tit` dependencies — see
> §2); firstlogin comment corrected (Debian sources bash.bashrc before
> profile.d); cobra-theme's loaded flag now set only after its checks pass.

> **2026-08-17: gap-closure pass — core gains SMB enum, offline exploit
> lookup, and local privesc enumeration.** Three audit-identified holes
> closed, all console-native and sync-rule compliant: (1) `smbenum` —
> `enum4linux-ng` joins CORE_PKGS (SMB/Windows null-session enumeration;
> nothing core-side covered SMB — nmap only sees the ports). (2) `sploit` —
> `exploitdb` promoted from the `exploit` profile to core (searchsploit +
> its local CSV are fully offline; the profile slims to metasploit only).
> (3) `privesc` — `shell/linpeas.sh` vendored from PEASS-ng releases
> (~1.1 MB) and installed to /etc/cobra, run LOCALLY against this box;
> cobrashell's `lpe()` stays the target-side download-and-execute variant
> and is now listed as such in README §3. No network calls added anywhere;
> each tool has its cobra-ops function and §2 row.

> **2026-08-17: audit fix pass.** Five logical errors fixed: (1) `crack`
> broken for the operator — Debian's john installs `/usr/sbin/john`, off the
> non-root PATH; now symlinked into `/usr/local/bin`. (2) The nftables input
> chain dropped ICMPv6 — NDP died, IPv6 with it; now accepted. (3)
> cobrashell's unconditional `TERM=xterm-256color` defeated cobra-theme's
> `TERM=linux` console palette remap — TERM is now only repaired when
> unset/dumb. (4) `/etc/hosts` lacked `localhost` on the rootfs path
> (debootstrap leaves it empty; the ISO's libnss-myhostname masked it) —
> now written idempotently. (5) The bash.bashrc COBRA block had no
> interactivity guard — a latent hang for non-interactive ssh shells if
> sshd is ever installed; guarded, with a sed retrofit for warm chroots.
> Plus: psmisc/bsdextrautils added (fuser, column, hexdump), hs_exit
> ghostdev teardown, `_HS_NP_D` rm -rf, GRUB theme `icon_height` typo,
> sha256 basename, opshelp hashcrack wording.

> **Header note (2026-08-16): console-only revert.** The X11/i3/Terminator
> dashboard + dormant Firefox ESR/Tor Browser layer (added 2026-08-15,
> debugged 2026-08-16) is **retired**. COBRA OS ships no X server, no
> display manager, and no GUI packages; tmux is the dashboard and `links2`
> (optionally via `torify`) is the browser. The Textual TUI
> (`tui/cobra_tui.py`) was already retired — its registry lives on as bash
> functions in `shell/cobra-ops.sh`. Do not resurrect either layer without
> an explicit operator decision recorded here.

> **2026-08-16: de-THC pass on cobrashell.** Full audit of the hackshell
> fork: no telemetry or phone-home exists anywhere (source-time path is
> local-only), but upstream's `sub()`/`ptr()` sent recon targets to
> `ip.thc.org` — **removed**; engagement targets must not leak to
> third-party infrastructure. `COBRA_RECON_HOST` is the hook for a future
> self-hosted recon service; `GS_HOST`/`GS_PORT` cover a self-hosted
> gsocket relay. `ipinfo()`, `loot`'s AWS-metadata check, and the `gs-*`
> tools bypassed the `xint` gate — now gated like everything else. `ws()`
> no longer pipes whatserver.sh from GitHub into bash: it runs the vendored
> `/etc/cobra/whatserver.sh` (network-free — its ipinfo.io lookup is
> stripped). `.` is no longer prepended to PATH. `gsinst`/`lpe`/`memexec`
> print remote-execution warnings; `ttyinject` warns it backdoors the local
> `~/.bashrc`. Target-side-only functions are listed in README.md §3.

> **2026-08-16: THC tips repo mined and dropped.** The two keepers from
> `thc-tips-tricks-hacks-cheat-sheet-master/` are vendored in `shell/`:
> `mkegg.sh` (cobra-ops `egg` wizard — self-extracting payload packer) and
> `upload_server.php` (cobra-ops `upserv` loot-drop receiver; its php-cli
> runtime rides the webplus profile, keeping core narrow). Rejected:
> `awk_netstat.sh` (redundant with `ss` + cobrashell `loot`) and
> `zap-args.c` (redundant with cobrashell `hide`; needs a compiler in the
> image). ghostip.sh/whatserver.sh were already vendored. The upstream repo
> dir was deleted after mining — provenance lives in the vendored headers.

## §1. Architecture

- **Base**: Debian `trixie` `--variant=minbase` via debootstrap
  (`build-rootfs.sh`), then `chroot-setup.sh` inside the chroot.
- **Tool feed**: Parrot OS repo, suite `parrot` (rolling alias for the
  current release — codename `echo`, Parrot 7, trixie-built). The frozen
  `lory` suite (Parrot 6) carries stub indexes only. Verify against
  https://deb.parrot.sh/parrot/dists/ before touching `PARROT_SUITE`.
- **Single source of truth**: `chroot-setup.sh` is reused verbatim as the
  live-build chroot hook (`build-iso.sh`) — one toolset, one hardening
  pass, two outputs (`./rootfs/` and `cobra-os-<date>.iso`).
- **Shell layer**: `/etc/cobra/cobrashell.sh` (THC hackshell fork) +
  `/etc/cobra/cobra-ops.sh` (command registry), both sourced from
  `/etc/bash.bashrc` for interactive shells, `HUSH=1` fast mode,
  `COBRA_SHELL_OFF=1` opt-out.
- **Console-only**: no X11, no Wayland, no DM, no GUI toolkits. tmux
  splits/tabs replace the retired Terminator dashboard; `xtmux` gives a
  socket-hidden tmux. Anything that needs `startx` is out of scope.
- **Theme layer**: `/etc/cobra/cobra-theme.sh` (console palette, LS_COLORS,
  less/grep colors) + `/etc/tmux.conf` + `/etc/issue` banner + boot splash
  (`splash.png`, flattened from `Cobras-OS.png`). Pure escape sequences and
  bootloader configs — zero packages, zero X. See §6.

## §2. Core tool set (the sync table)

Registry rule: **function in `shell/cobra-ops.sh` ↔ package in
`chroot-setup.sh` ↔ row here.** Keep all three in sync.

| cobra-ops function | package | purpose |
|---|---|---|
| `fscan` `portscan` `svcscan` `vulnscan` `udpscan` | nmap | TCP/UDP/service/vuln scanning |
| `dnsq` | dnsutils | dig lookups |
| `whois` | whois | domain/IP whois |
| `smbenum` | enum4linux-ng | SMB/Windows null-session enum (shares, users, policy) |
| `webdir` | gobuster | directory brute-force |
| `webdir` (wordlist) | dirb, wordlists | `common.txt`, `rockyou.txt` |
| `webvuln` | nikto | web server scan |
| `sql` | sqlmap | SQL injection (python3 runtime) |
| `brute` | hydra | service brute-force + rockyou |
| `crack` | john | hash cracking |
| `hashcrack` | hashcat | GPU/hash-mode cracking |
| `sploit` | exploitdb | offline exploit-db search (searchsploit + local CSV) |
| `listen` | netcat-traditional | reverse-shell catcher |
| `sniff` | tcpdump | live capture |
| `pcap` | tshark | live decode |
| `serve` | python3 (BASE) | payload hosting |
| `mon` | btop | system monitor dashboard |
| `files` | nnn | console file manager |
| `web` | links2 | text browser (xint-gated, loopback open; Tor via `torify links2`) |
| `egg` | — (vendored mkegg.sh; tar/gzip BASE) | self-extracting payload packer |
| `privesc` | — (vendored linpeas.sh; PEASS-ng) | local privesc enum of THIS box (no network) |
| `upserv` | php-cli (**webplus** profile) | loot-drop upload server |
| — (cobrashell `ghostip`/`ghostdev`/`bounce`) | iptables | SNAT/DNAT mark tricks (nft-translated) |
| — (cobrashell web/proxy paths) | tor, torsocks, proxychains4 | anonymity + pivoting |
| — | aircrack-ng | 802.11 auditing base |
| — | macchanger | MAC ops |
| — | wireguard-tools | wg tunnels (`ghostdev`) |
| — (dashboard) | tmux (BASE) | panes/splits; `xtmux` hidden socket |

Base system packages (init, network, shell plumbing) are listed in
`BASE_PKGS` with inline justifications in `chroot-setup.sh` — including the
small cobrashell support utilities (`psmisc` for `fuser`/xtmux socket
cleanup, `bsdextrautils` for `column`/`hexdump`, `iputils-ping` for
ghostip.sh/linpeas, `strace` for cobrashell `tit`).

### §2a. Profiles (`COBRA_PROFILES`, space-separated)

| profile | packages | notes |
|---|---|---|
| `wireless` | bettercap hcxtools hcxdumptool reaver bully kismet | all console UIs |
| `ad` | python3-impacket impacket-scripts responder netexec bloodhound.py | AD/Windows ops |
| `exploit` | metasploit-framework | msfconsole is a TTY citizen (exploitdb/searchsploit is core — see §2) |
| `webplus` | mitmproxy ffuf seclists wpscan php-cli | mitmproxy **replaces burpsuite** (Java GUI — dead weight without X); php-cli runs the vendored upload_server.php (`upserv`) |

Retired profiles: `headless` (obsolete — every build is headless now).

## §3. Web access (console-only)

- Browser: `links2` only. The cobra-ops `web` function enforces
  cobrashell's `xint` gate before launching — deliberate internet use,
  same philosophy as `transfer`/`tb`.
- Tor path: system `tor` daemon (SOCKS `127.0.0.1:9050`) + `torsocks`:
  `xint && torify links2 <url>`. `proxychains4` covers other tools;
  cobrashell's `proxy 9050` exports socks5h env vars.
- Never re-add GUI browsers (Firefox ESR/Tor Browser were removed with the
  X stack): they were the single largest size/attack-surface item in the
  image, and a browser you must summon from a text console stays honest.

## §4. Hardening

Applied in `chroot-setup.sh` (idempotent):

- root locked (`passwd -l`), sudo-only via `operator` (password
  `changeme`; tty1 console autologin + one-time forced `passwd` via
  /etc/profile.d/00-cobra-firstlogin.sh — replaced the `chage -d 0` PAM
  flow on 2026-08-18: it made operators type 'changeme' twice in a row)
- nftables default-deny input/forward; loopback + established allowed;
  ICMPv4 + ICMPv6 allowed (ICMPv6 carries NDP — without it IPv6 dies on the
  LAN); output open (operator box, not a server)
- sysctl: kptr/dmesg/BPF/kexec restrictions, fs.protected_*, IPv4/IPv6
  network sanity (`ip_forward=0` — cobrashell `bounce` flips at runtime)
- modprobe blacklist: usb-storage off by default, legacy
  protocols/filesystems off
- anti-forensics: history to /dev/null for bash/less/mysql/psql/sqlite/
  redis (`/etc/profile.d/00-cobra-nolog.sh` + cobrashell), XHOME in
  /dev/shm with auto-destruct
- NetworkManager: random Wi-Fi MAC per connection, stable ethernet MAC
- apt: `APT::Keep-Downloaded-Packages "false"` — no .deb cache in images
- docs/man/info stripped; apt lists dropped (rootfs build only)
- retired-layer purge: TUI artifacts AND the X11/GUI package set are
  purged so warm chroots (SKIP_DEBOOTSTRAP, live-build cache) converge

## §5. Live ISO (`build-iso.sh`)

- `lb config`: trixie, iso-hybrid (BIOS+UEFI), minbase bootstrap,
  `--apt-recommends false`, no debian-installer/memtest/firmware bundles,
  `--linux-packages linux-image` (live-build owns kernel + bootloader —
  `COBRA_ISO=1` makes `chroot-setup.sh` skip kernel/grub).
- Chroot package list: `live-boot cryptsetup initramfs-tools
  libnss-myhostname` only; everything else comes from the hook.
- The hook (`config/hooks/normal/9000-cobra.hook.chroot`) runs
  `chroot-setup.sh` with `COBRA_ISO=1`, then purges `live-config*` (its
  passwordless-sudo `user` / `debian` hostname would fight the baked
  operator/hostname).
- Boot params: `boot=live noswap persistence quiet`. `persistence` +
  cryptsetup = LUKS persistence sticks; `noswap` keeps RAM-only semantics;
  `toram` is a deliberate TAB-edit (doubles RAM use).
- LUKS persistence stick recipe: create a second partition on the USB,
  `cryptsetup luksFormat` + `mkfs.ext4 -L persistence`, and an
  `persistence.conf` of `/ union` inside it — live-boot unlocks/mounts it
  at boot. Caveat: the usb-storage modprobe blacklist (§4) only bites when
  the ISO was booted from non-USB media (VM/CD) — boot-from-USB loads the
  module in the initramfs. For a VM/CD session, comment out the
  `install usb-storage` line in `/etc/modprobe.d/hardening.conf` first.
- Work dir `/var/tmp/cobra-live` (live-build refuses paths with spaces —
  the project dir has one). Rebuilt ISO lands back in the project dir with
  a `.sha256`.
- Smoke test: `qemu-system-x86_64 -m 2G -cdrom cobra-os-*.iso`.
- Boot theme: `splash.png` overlays `isolinux/splash.png` +
  `boot/grub/splash.png` via `config/includes.binary` (the exact paths lb's
  own templates reference), and binary hook `9010-cobra-theme.hook.binary`
  rewrites `isolinux/stdmenu.cfg`, `boot/grub/live-theme/theme.txt` and
  `boot/grub/theme.cfg` with the COBRA palette — lb regenerates those files
  from its templates on every build, so the hook rewrites them every build.
  Cosmetics never fail the build (directory guards).

## §6. Boot & console theme (red-team cyberpunk, no X)

Palette ramp: bg `#050508`, fg `#d6dbe2`, neon red `#ff2a3c` (primary),
phosphor green `#3dff8f`, amber `#ffb84d`, electric blue `#4d7cff`, neon
violet `#c95cff`, neon cyan `#2ee6e6`, gunmetal `#3a3f4a` (dim).

- **Boot splash**: `splash.png` (640x480 RGB, flattened from
  `Cobras-OS.png` — vesamenu-safe, no alpha). ISO: includes.binary overlay
  + binary hook (§5). Rootfs builds: installed to `/boot/grub/splash.png`
  with `/etc/default/grub.d/90-cobra-theme.cfg` (`GRUB_BACKGROUND` +
  red/cyan menu colors), picked up on the next `update-grub`.
- **Console palette**: `shell/cobra-theme.sh` remaps the Linux console's
  16 VGA slots via `\e]P0`–`\e]PF` when `TERM=linux`, so cobrashell's
  existing PS1 and color vars go neon with zero changes to the hackshell
  fork. No-op under tmux/ssh (those terminals own their palette).
  `COBRA_THEME_OFF=1` opts out.
- **LS_COLORS**: built at image-build time from `dircolors -p` (full
  extension coverage kept) with classes re-tinted — cyan dirs, violet
  links/images, neon-red executables/sockets/archives, amber devices.
  Rendered to `/etc/cobra/ls_colors`, sourced by the theme.
- **tmux**: `/etc/tmux.conf` — near-black status bar, neon-red `COBRA`
  tag/active tab/pane border, cyan clock. `tmux-256color` (ncurses-base)
  + truecolor passthrough.
- **/etc/issue**: red ASCII COBRA banner + cyan tagline, real ESC bytes
  (agetty prints the file raw) so even the login prompt is themed.
- **opshelp**: `cobra-ops.sh`'s help screen colors itself with
  cobrashell's own color vars (raw 16-color SGR fallback when sourced
  standalone, no escapes when piped) — bold-red headers, phosphor-green
  commands, amber gotchas, faint parentheticals. The console palette
  remap turns the same slots neon; zero extra machinery.
- Deliberately NOT Plymouth/dracut splash: an initramfs theme daemon is
  bloat against the minimalism directive; the bootloader menu + login
  banner carry the aesthetic at zero runtime cost.

## §7. Scaffold defaults — change before deploying

- `changeme` operator password in `chroot-setup.sh` is a documented
  scaffold default with forced change on first login. Never hardcode a
  "real" password in the repo — set one at deploy time.
- Re-verify `PARROT_SUITE` against deb.parrot.sh before builds.
- Review the nftables input rules for your op (e.g. allow 4444 when
  expecting a reverse shell).
- Review the core tool list against the engagement — profiles exist so the
  core stays narrow.
