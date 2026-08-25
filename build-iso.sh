#!/usr/bin/env bash
#
# build-iso.sh
# Builds the bootable COBRA OS live ISO with live-build, reusing the SAME
# chroot-setup.sh as the rootfs build (single source of truth — see
# BUILD_PLAN.md §5):
#
#   - lb config: trixie, iso-hybrid (BIOS+UEFI), minimal bootstrap, no
#     debian-installer / memtest / firmware bundles, apt --no-recommends
#   - package list: live-boot (squashfs mounting, `toram`, `persistence`)
#     + cryptsetup (LUKS persistence unlock at boot). The hook PURGES
#     lb's auto-added live-config — its defaults (passwordless-sudo "user",
#     hostname "debian") would fight the operator/hostname we bake.
#   - a chroot hook runs chroot-setup.sh with COBRA_ISO=1 (skips kernel +
#     grub-pc — live-build owns boot; the ISO gets the Debian trixie LTS
#     kernel via --linux-packages), then rebuilds the initramfs so the
#     live-boot/cryptsetup hooks land in it.
#   - boot theme: splash.png (flattened 640x480 render of Cobras-OS.png)
#     overlays the isolinux + GRUB splash via includes.binary, and a binary
#     hook rewrites stdmenu.cfg / live-theme/theme.txt / theme.cfg with the
#     COBRA cyberpunk palette (lb regenerates those files every build, so
#     the hook rewrites them every build too).
#
# Usage:
#   sudo ./build-iso.sh                            # core toolset ISO
#   sudo COBRA_PROFILES="wireless" ./build-iso.sh  # bake in a profile
#
# Requires: live-build + debootstrap on the host, ~8G free under LB_DIR,
# network, root. Re-running reuses LB_DIR's cached bootstrap/packages.
# NOTE: live-build refuses to build from a path containing spaces, so the
# work dir lives at /var/tmp/cobra-live by default (our project dir has a
# space in its name). The finished ISO is still moved back here.
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LB_DIR="${LB_DIR:-/var/tmp/cobra-live}"
ISO_OUT="${ISO_OUT:-$PROJECT_DIR/cobra-os-$(date +%Y%m%d).iso}"
DEBIAN_SUITE="${DEBIAN_SUITE:-trixie}"
# live-boot params: `persistence` enables LUKS sticks (BUILD_PLAN §5),
# `noswap` keeps RAM-only semantics. `toram` is deliberately NOT default
# (doubles RAM use) — TAB-edit it in at the boot menu when wanted.
# Serial console (2026-08-24): console=tty0 keeps the local screen live,
# console=ttyS0 (LAST console= wins /dev/console) makes systemd auto-start
# serial-getty@ttyS0 — the VM is drivable over COM1 (VirtualBox Host Pipe /
# QEMU -serial) with no per-boot TAB-edit. Local console, not a network
# listener, so no hardening default moves. BOOTAPPEND=... overrides all of it.
BOOTAPPEND="${BOOTAPPEND:-boot=live noswap persistence quiet console=tty0 console=ttyS0,115200}"

require_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "[-] This script must be run as root (live-build needs it)." >&2
    exit 1
  fi
}

require_tools() {
  for tool in lb debootstrap; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "[-] Missing required tool: $tool" >&2
      echo "    On Debian/Ubuntu: apt install live-build debootstrap" >&2
      exit 1
    }
  done
}

require_root
require_tools

if [[ "$LB_DIR" =~ [[:space:]] ]]; then
  echo "[-] live-build cannot work in a path containing spaces: $LB_DIR" >&2
  echo "    Set LB_DIR to a space-free path (e.g. /var/tmp/cobra-live)." >&2
  exit 1
fi

mkdir -p "$LB_DIR"
cd "$LB_DIR"

if [[ -d config ]]; then
  echo "[*] Reusing existing live-build tree at $LB_DIR"
  echo "    (rm -rf '$LB_DIR' to reconfigure from scratch)"
else
  echo "[*] lb config ($DEBIAN_SUITE, iso-hybrid, minimal flavour)..."
  lb config \
    --distribution "$DEBIAN_SUITE" \
    --binary-image iso-hybrid \
    --debootstrap-options "--variant=minbase" \
    --archive-areas "main contrib non-free non-free-firmware" \
    --linux-packages "linux-image" \
    --bootappend-live "$BOOTAPPEND" \
    --debian-installer none \
    --memtest none \
    --firmware-binary false \
    --firmware-chroot false \
    --apt-recommends false \
    --apt-source-archives false \
    --iso-application "COBRA OS" \
    --iso-volume "COBRA_LIVE" \
    --iso-publisher "COBRA OS - authorized use only" \
    --zsync false
fi

echo "[*] Writing live package list (live-boot + cryptsetup only — the hook installs the rest)..."
mkdir -p config/package-lists
cat > config/package-lists/cobra-live.list.chroot << 'EOF'
# live-boot: initramfs live mounting (squashfs, toram, persistence)
# cryptsetup: LUKS persistence unlock at boot (BUILD_PLAN.md §5)
# initramfs-tools: only a Recommends of live-boot and --apt-recommends is
# false, but lb chroot_hacks + the kernel postinst need it for the initrd.
# libnss-myhostname: live-build manages /etc/hosts itself and the image ends
# up with an EMPTY one — nss-myhostname resolves localhost + the local
# hostname (cobra) regardless of file content.
live-boot
cryptsetup
initramfs-tools
libnss-myhostname
EOF
# If the package list changed since the last build, lb's "already done"
# markers would skip it — clear them so the live pass re-runs. lb doesn't
# track chroot->binary deps either, so re-pack the binary stages too.
rm -f .build/chroot_install-packages* .build/chroot_package-lists* 2>/dev/null || true
rm -f .build/chroot_hooks* 2>/dev/null || true   # our hook is idempotent — always re-run it
rm -f .build/binary_* 2>/dev/null || true
# CRITICAL (2026-08-23): clear the includes.chroot markers too. lb caches the
# "includes copied" stage; on a reused tree the stale marker means our freshly
# staged files (config/includes.chroot/root/cobra-stage/*) are NOT re-copied
# into the chroot before the 9000-cobra hook runs — the hook then sees an empty
# /root/cobra-stage and (for ai builds) silently skips the CobraStrike install,
# shipping an ISO with nodejs but no cobra launcher. Force a re-copy every build.
rm -f .build/chroot_includes* 2>/dev/null || true
# CRITICAL (2026-08-24): clear the kernel-stage marker too. We clear binary_*,
# hooks, and includes so our staged files/hook always re-run — but a surviving
# .build/chroot_linux-image marker makes lb SKIP the chroot kernel install,
# then binary_linux-image does `cp chroot/boot/vmlinuz-*` against an empty
# /boot and aborts: "cannot stat 'chroot/boot/vmlinuz-*'". Force a re-install
# whenever we re-run the chroot (idempotent; initramfs rebuilds need a kernel).
rm -f .build/chroot_linux-image* 2>/dev/null || true
# NOTE: the dpkg conffile non-interactivity (2026-08-24 /etc/issue prompt) is
# handled INSIDE the chroot by chroot-setup.sh's /etc/apt/apt.conf.d/90cobra-*
# drop-in — env vars here don't reliably cross into live-build's chroot'd apt.

echo "[*] Staging COBRA files into config/includes.chroot ..."
STAGE="config/includes.chroot/root/cobra-stage"
# rm -rf first: the live-build tree is reused across builds, so files RETIRED
# from the repo (e.g. the pre-refactor Textual TUI: cobra_tui.py,
# cobra-console.sh, cobra-tmux.conf, requirements.txt) would otherwise linger
# here and leak into the ISO — exactly what happened in the 2026-08-15 build.
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "$PROJECT_DIR/chroot-setup.sh" "$STAGE/chroot-setup.sh"
cp "$PROJECT_DIR/shell/cobrashell.sh" "$STAGE/cobrashell.sh"
cp "$PROJECT_DIR/shell/ghostip.sh" "$STAGE/ghostip.sh"
cp "$PROJECT_DIR/shell/whatserver.sh" "$STAGE/whatserver.sh"
cp "$PROJECT_DIR/shell/mkegg.sh" "$STAGE/mkegg.sh"
cp "$PROJECT_DIR/shell/upload_server.php" "$STAGE/upload_server.php"
cp "$PROJECT_DIR/shell/linpeas.sh" "$STAGE/linpeas.sh"
cp "$PROJECT_DIR/shell/cobra-ops.sh" "$STAGE/cobra-ops.sh"
cp "$PROJECT_DIR/shell/cobra-theme.sh" "$STAGE/cobra-theme.sh"
cp "$PROJECT_DIR/splash.png" "$STAGE/splash.png"

# CobraStrike AI operator (COBRA_PROFILES=ai): stage the pre-built bundles only
# for ai builds so the minimal image never carries the Node stack. chroot-setup
# installs them when the profile is active. Rebuild dist/ first if stale.
if [[ " ${COBRA_PROFILES:-} " == *" ai "* ]]; then
    for b in "CobraStrike/cobra-client/dist/cobra.js" "CobraStrike/cobra-mcp/dist/cobra-mcp.js"; do
        if [[ ! -f "$PROJECT_DIR/$b" ]]; then
            echo "[!] COBRA_PROFILES=ai but $b is missing — run: (cd CobraStrike/cobra-client && npm run bundle) and (cd CobraStrike/cobra-mcp && npm run bundle)" >&2
            exit 1
        fi
    done
    cp "$PROJECT_DIR/CobraStrike/cobra-client/dist/cobra.js" "$STAGE/cobra.js"
    cp "$PROJECT_DIR/CobraStrike/cobra-mcp/dist/cobra-mcp.js" "$STAGE/cobra-mcp.js"
    # Doctrine tree the agent reads at runtime: brain (living memory + mission
    # template + playbooks), tradecraft guides, the CobraStrike mkegg variant
    # (payload_egg_build), and the build plan (cobra://buildplan resource).
    # Without these the server's repo-relative path defaults resolve to "/" on
    # an installed box and every knowledge lookup comes back "(not found)".
    cp -r "$PROJECT_DIR/CobraStrike/brain" "$STAGE/brain"
    cp -r "$PROJECT_DIR/CobraStrike/tradecraft" "$STAGE/tradecraft"
    mkdir -p "$STAGE/cobra-scripts"
    cp "$PROJECT_DIR/CobraStrike/scripts/mkegg.sh" "$STAGE/cobra-scripts/mkegg.sh"
    cp "$PROJECT_DIR/CobraStrike/BUILD_PLAN.md" "$STAGE/cobra-buildplan.md"
    echo "[*] staged CobraStrike bundles + doctrine tree (ai profile)"
    # Optional operator-key bake (2026-08-23): same mechanism as the rootfs
    # build — the local, gitignored key file (secrets/openrouter.key, relative
    # to the project dir; override with COBRA_OPENROUTER_KEY_FILE) rides the
    # stage dir so chroot-setup.sh installs it as the operator's
    # ~/.config/cobra/credentials (0600) — no typing/pasting long keys into
    # console VMs. Self-built, self-used images ONLY: the squashfs embeds the
    # key in plaintext, so a keyed image must never be distributed. The key's
    # content is never logged. NB: $PROJECT_DIR prefix is mandatory — this
    # script cd's into $LB_DIR.
    COBRA_KEY_FILE="${COBRA_OPENROUTER_KEY_FILE:-$PROJECT_DIR/secrets/openrouter.key}"
    if [[ -f "$COBRA_KEY_FILE" ]]; then
        if grep -q '[^[:space:]]' "$COBRA_KEY_FILE"; then
            install -m 0600 "$COBRA_KEY_FILE" "$STAGE/openrouter.key"
            echo "[*] staged operator OpenRouter key ($COBRA_KEY_FILE)"
            echo "[!] baking a live OpenRouter key into this image — do NOT distribute it" >&2
        else
            echo "[!] $COBRA_KEY_FILE is empty — ignoring (the image will prompt for a key instead)" >&2
        fi
    else
        echo "[*] no operator key staged ($COBRA_KEY_FILE absent) — the image will prompt on first cobra run"
    fi
else
    if [[ -f "${COBRA_OPENROUTER_KEY_FILE:-$PROJECT_DIR/secrets/openrouter.key}" ]]; then
        echo "[!] ${COBRA_OPENROUTER_KEY_FILE:-$PROJECT_DIR/secrets/openrouter.key} exists but COBRA_PROFILES lacks 'ai' — key NOT staged (no CobraStrike in this image)" >&2
    fi
fi
chmod +x "$STAGE/chroot-setup.sh"


echo "[*] Writing the COBRA chroot hook (baking in operator knobs)..."
# The chroot sees none of our environment, so bake the knobs into the hook
# at generation time using individual export lines — a single HOOK_VARS string
# breaks when COBRA_PROFILES contains spaces (bash splits on whitespace and
# tries to run the second word as a command, e.g. "wireless: command not found").
# Same four knobs build-rootfs.sh passes through CHROOT_ENV — 2026-08-19:
# COBRA_HOSTNAME/OPERATOR_USER were missing here, so the ISO silently
# ignored them (always baked the defaults).
mkdir -p config/hooks/normal
cat > config/hooks/normal/9000-cobra.hook.chroot << EOF
#!/bin/bash
# COBRA OS — run the exact same setup the rootfs build runs (idempotent).
set -e
export HOME=/root
export DEBIAN_FRONTEND=noninteractive
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export COBRA_ISO=1
${PARROT_SUITE:+export PARROT_SUITE='$PARROT_SUITE'}
${COBRA_HOSTNAME:+export COBRA_HOSTNAME='$COBRA_HOSTNAME'}
${OPERATOR_USER:+export OPERATOR_USER='$OPERATOR_USER'}
${COBRA_PROFILES:+export COBRA_PROFILES='$COBRA_PROFILES'}
/root/cobra-stage/chroot-setup.sh
# Fail loudly if an ai build didn't bake the CobraStrike launcher — the silent
# "cobra: not installed" ISO happens when includes.chroot wasn't re-copied into
# the chroot before this hook (stale .build marker). See build-iso.sh.
if [[ " ${COBRA_PROFILES:-} " == *" ai "* ]]; then
    if [[ ! -x /usr/local/bin/cobra ]]; then
        echo "[!] COBRA_PROFILES=ai but /usr/local/bin/cobra is missing — the staged bundles never reached the chroot" >&2
        exit 1
    fi
    # Same fail-loudly for the optional operator-key bake: if a key was
    # staged, it must have landed as the operator's credentials file.
    if [[ -f /root/cobra-stage/openrouter.key && ! -s /home/${OPERATOR_USER:-operator}/.config/cobra/credentials ]]; then
        echo "[!] staged OpenRouter key did not land in /home/${OPERATOR_USER:-operator}/.config/cobra/credentials" >&2
        exit 1
    fi
fi
# live-build's live pass auto-adds live-config — it would create the default
# "user" account (passwordless sudo) and force hostname "debian", fighting
# the operator/hostname baked by chroot-setup.sh. Purge it.
apt-get purge -y live-config live-config-systemd live-config-doc || true
# live-build's kernel phase runs AFTER hooks, so initramfs-tools usually
# isn't installed yet — the kernel postinst builds the initrd later and
# picks up the live-boot/cryptsetup hooks itself. Refresh only when an
# initramfs already exists (incremental rebuilds).
if command -v update-initramfs >/dev/null 2>&1; then
  update-initramfs -u -k all
fi
rm -rf /root/cobra-stage
EOF
chmod +x config/hooks/normal/9000-cobra.hook.chroot

echo "[*] Staging boot splash (isolinux + GRUB) into config/includes.binary ..."
# includes.binary is copied over the ISO staging root AFTER lb installs the
# bootloaders, so these overlay the default splash at both paths lb's own
# configs reference (isolinux/stdmenu.cfg: "menu background splash.png",
# grub-pc/live-theme/theme.txt: desktop-image "../splash.png").
mkdir -p config/includes.binary/isolinux config/includes.binary/boot/grub
cp "$PROJECT_DIR/splash.png" config/includes.binary/isolinux/splash.png
cp "$PROJECT_DIR/splash.png" config/includes.binary/boot/grub/splash.png

echo "[*] Writing the COBRA binary hook (cyberpunk bootloader theme)..."
# Binary hooks run with cwd = binary/ (the ISO staging root), after
# binary_includes and before binary_iso. lb REGENERATES stdmenu.cfg,
# theme.txt and theme.cfg on every build from its own templates, so this
# hook rewrites them on every build — cosmetics must never fail a build,
# hence the directory guards.
mkdir -p config/hooks/normal
cat > config/hooks/normal/9010-cobra-theme.hook.binary << 'EOF'
#!/bin/bash
# COBRA OS — binary-stage theme hook: red-team cyberpunk boot menus.
set -e

# --- isolinux (BIOS): neon-on-black vesamenu ---------------------------
# Syslinux menu colors are #AARRGGBB (alpha first; 00 = transparent).
if [ -d isolinux ]; then
cat > isolinux/stdmenu.cfg << 'EOCFG'
menu background splash.png
menu color title	* #FFFF2A3C *
menu color border	* #00000000 #00000000 none
menu color sel		* #FF050508 #FFFF2A3C *
menu color hotsel	1;7;37;40 #FF050508 #FFFF2A3C *
menu color tabmsg	* #FFFFB84D #00000000 *
menu color help		37;40 #FF2EE6E6 #00000000 none
menu vshift 12
menu rows 10
menu helpmsgrow 15
# The command line must be at least one line from the bottom.
menu cmdlinerow 16
menu timeoutrow 16
menu tabmsgrow 18
menu tabmsg Press ENTER to boot or TAB to edit a menu entry
EOCFG
fi

# --- GRUB (BIOS+UEFI): COBRA live-theme ---------------------------------
# lb's generated theme.cfg only activates the theme when
# /boot/grub/splash.png exists — our includes.binary overlay guarantees
# that, so the themed path always wins. theme.txt colors are #RRGGBB.
if [ -d boot/grub ]; then
mkdir -p boot/grub/live-theme
cat > boot/grub/live-theme/theme.txt << 'EOCFG'
desktop-image: "../splash.png"
title-color: "#ff2a3c"
title-font: "Unifont Regular 16"
title-text: "COBRA OS :: authorized use only"
message-font: "Unifont Regular 16"
terminal-font: "Unifont Regular 16"

# help bar at the bottom
+ label {
	top = 100%-50
	left = 0
	width = 100%
	height = 20
	text = "@KEYMAP_SHORT@"
	align = "center"
	color = "#3a3f4a"
	font = "Unifont Regular 16"
}

# boot menu
+ boot_menu {
	left = 10%
	width = 80%
	top = 52%
	height = 48%-80
	item_color = "#d6dbe2"
	item_font = "Unifont Regular 16"
	selected_item_color = "#ff2a3c"
	selected_item_font = "Unifont Regular 16"
	item_height = 16
	item_padding = 0
	item_spacing = 4
	icon_width = 0
	icon_height = 0
	item_icon_space = 0
}

# timeout progress bar
+ progress_bar {
	id = "__timeout__"
	left = 15%
	top = 100%-80
	height = 16
	width = 70%
	font = "Unifont Regular 16"
	text_color = "#050508"
	fg_color = "#ff2a3c"
	bg_color = "#3a3f4a"
	border_color = "#ff2a3c"
	text = "@TIMEOUT_NOTIFICATION_LONG@"
}
EOCFG

# Fallback colors when the theme can't load — kept cyberpunk anyway.
# ("black" is transparent over the splash once a background is set.)
cat > boot/grub/theme.cfg << 'EOCFG'
set color_normal=light-cyan/black
set color_highlight=red/black

if [ -e /boot/grub/splash.png ]; then
    set theme=/boot/grub/live-theme/theme.txt
else
    set menu_color_normal=light-cyan/black
    set menu_color_highlight=red/black
fi
EOCFG
fi
EOF
chmod +x config/hooks/normal/9010-cobra-theme.hook.binary

echo "[*] Writing the COBRA serial-console hook (BIOS+UEFI boot menus over COM1)..."
# Pairs with the console=ttyS0 in BOOTAPPEND: the KERNEL gets a serial console
# via the boot line, but the BOOTLOADERS need their own serial directives or
# the boot menu is invisible/unusable over the wire (headless VMs can't pick
# an entry or type a LUKS passphrase). Same rules as the theme hook: binary
# stage, cwd = binary/, lb regenerates the cfgs every build so we rewrite
# them every build, and guards make cosmetics never fail the build.
mkdir -p config/hooks/normal
cat > config/hooks/normal/9020-cobra-serial.hook.binary << 'EOF'
#!/bin/bash
# COBRA OS — binary-stage serial hook: drive the boot menus over COM1.
set -e

# --- isolinux (BIOS) -------------------------------------------------------
# SERIAL <port> <baud>: bios/efi boot prompt + vesamenu I/O on ttyS0 while
# keeping the VGA console. Port 0 = COM1 (0x3F8), 115200 8N1.
if [ -d isolinux ]; then
    if grep -q '^SERIAL' isolinux/isolinux.cfg 2>/dev/null; then
        sed -i 's/^SERIAL.*/SERIAL 0 115200/' isolinux/isolinux.cfg
    else
        sed -i '1i SERIAL 0 115200' isolinux/isolinux.cfg
    fi
fi

# --- GRUB (BIOS + UEFI) ----------------------------------------------------
# lb's grub.cfg starts with `source /boot/grub/config.cfg`, so a prepended
# serial+terminal block there applies to every entry (live, failsafe,
# verify-checksums). Both terminals stay live: screen AND serial.
if [ -d boot/grub ]; then
    if [ -f boot/grub/config.cfg ]; then
        grep -q '^serial ' boot/grub/config.cfg || \
            sed -i '1i serial --unit=0 --speed=115200 --word=8 --parity=no --stop=1\nterminal_input serial console\nterminal_output serial console' \
                boot/grub/config.cfg
    else
        printf '%s\n' \
            'serial --unit=0 --speed=115200 --word=8 --parity=no --stop=1' \
            'terminal_input serial console' \
            'terminal_output serial console' > boot/grub/config.cfg
    fi
fi
EOF
chmod +x config/hooks/normal/9020-cobra-serial.hook.binary

# On reruns, lb marks chroot_includes complete and skips it — leaving the
# chroot with a stale (or missing) stage dir. Copy the stage directly into
# an existing chroot so the hook always runs the CURRENT chroot-setup.sh.
if [[ -d chroot ]]; then
  rm -rf chroot/root/cobra-stage   # same staleness hazard as includes.chroot
  mkdir -p chroot/root/cobra-stage
  cp "$PROJECT_DIR/chroot-setup.sh" chroot/root/cobra-stage/chroot-setup.sh
  cp "$PROJECT_DIR/shell/cobrashell.sh" chroot/root/cobra-stage/cobrashell.sh
  cp "$PROJECT_DIR/shell/ghostip.sh" chroot/root/cobra-stage/ghostip.sh
  cp "$PROJECT_DIR/shell/whatserver.sh" chroot/root/cobra-stage/whatserver.sh
  cp "$PROJECT_DIR/shell/mkegg.sh" chroot/root/cobra-stage/mkegg.sh
  cp "$PROJECT_DIR/shell/upload_server.php" chroot/root/cobra-stage/upload_server.php
  cp "$PROJECT_DIR/shell/linpeas.sh" chroot/root/cobra-stage/linpeas.sh
  cp "$PROJECT_DIR/shell/cobra-ops.sh" chroot/root/cobra-stage/cobra-ops.sh
  cp "$PROJECT_DIR/shell/cobra-theme.sh" chroot/root/cobra-stage/cobra-theme.sh
  cp "$PROJECT_DIR/splash.png" chroot/root/cobra-stage/splash.png

  chmod +x chroot/root/cobra-stage/chroot-setup.sh
fi

# Pre-flight: fail fast if the filesystem can't hold the image. The failure we
# are guarding against (2026-08-24): xorriso is the LAST step of `lb build` and
# refuses to write unless its whole estimated image fits on the destination fs —
# a near-full disk (old ISO still sitting in the project dir, same fs) makes the
# entire long build abort at the very end with "Image size exceeds free space on
# media". Check BOTH filesystems involved: $LB_DIR (where xorriso writes the
# live-image-*.hybrid.iso) and $ISO_OUT's dir (where the finished ISO is moved).
# Need >= the known-good image size with headroom for the estimate being low.
# Override with ISO_NEED_BYTES / ISO_HEADROOM_BYTES if a profile grows the image.
ISO_KNOWN_GOOD_BYTES="${ISO_KNOWN_GOOD_BYTES:-2609577984}"   # 2026-08-24 ai build
ISO_HEADROOM_BYTES="${ISO_HEADROOM_BYTES:-536870912}"        # 512M safety margin
ISO_NEED_BYTES=$(( ISO_KNOWN_GOOD_BYTES + ISO_HEADROOM_BYTES ))
_iso_check_space() { # <dir> <label>
    local dir="$1" label="$2" avail
    mkdir -p "$dir" 2>/dev/null || true
    avail=$(df -B1 --output=avail "$dir" 2>/dev/null | tail -1 | tr -d '[:space:]')
    if [[ -n "$avail" && "$avail" =~ ^[0-9]+$ && "$avail" -lt "$ISO_NEED_BYTES" ]]; then
        echo "[-] Not enough space for the ISO on $label ($dir):" >&2
        echo "      free:  $(( avail / 1024 / 1024 )) MiB" >&2
        echo "      needs: $(( ISO_NEED_BYTES / 1024 / 1024 )) MiB (image + headroom)" >&2
        echo "    Free space (e.g. remove an old cobra-os-*.iso) and re-run." >&2
        exit 1
    fi
    echo "[*] disk check: $label ($dir) has $(( ${avail:-0} / 1024 / 1024 )) MiB free (need $(( ISO_NEED_BYTES / 1024 / 1024 )) MiB)"
}
_iso_check_space "$LB_DIR" "build tree"
_iso_check_space "$(dirname "$ISO_OUT")" "ISO output"

echo "[*] lb build — fresh chroot + full toolset install; this is the long one..."
lb build

ISO_SRC="$(ls -t live-image-*.hybrid.iso 2>/dev/null | head -1 || true)"
if [[ -z "$ISO_SRC" ]]; then
  echo "[-] lb build finished but no live-image-*.hybrid.iso found in $LB_DIR" >&2
  exit 1
fi

# ISO_OUT is on the same fs as the project dir (default). Ensure IT can hold the
# image too — xorriso already guaranteed LB_DIR, but mv across the same fs is a
# rename; if ISO_OUT pointed at another fs it'd be a copy needing its own room.
mv -f "$ISO_SRC" "$ISO_OUT"
# Record the hash with the bare filename so `sha256sum -c` works from the
# ISO's directory (the absolute path also contains a space).
( cd "$(dirname "$ISO_OUT")" && sha256sum "$(basename "$ISO_OUT")" > "$(basename "$ISO_OUT").sha256" )

echo "[*] Done: $ISO_OUT"
echo "[*]        $ISO_OUT.sha256"
echo "[*] Verify before USB: qemu-system-x86_64 -m 2G -cdrom \"$ISO_OUT\""
echo "[*] Write to stick:    dd if=\"$ISO_OUT\" of=/dev/sdX bs=4M status=progress conv=fsync"
echo "[*] LUKS persistence:  see BUILD_PLAN.md §5"
