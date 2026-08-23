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
BOOTAPPEND="${BOOTAPPEND:-boot=live noswap persistence quiet}"

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
    echo "[*] staged CobraStrike bundles (ai profile)"
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

echo "[*] lb build — fresh chroot + full toolset install; this is the long one..."
lb build

ISO_SRC="$(ls -t live-image-*.hybrid.iso 2>/dev/null | head -1 || true)"
if [[ -z "$ISO_SRC" ]]; then
  echo "[-] lb build finished but no live-image-*.hybrid.iso found in $LB_DIR" >&2
  exit 1
fi

mv -f "$ISO_SRC" "$ISO_OUT"
# Record the hash with the bare filename so `sha256sum -c` works from the
# ISO's directory (the absolute path also contains a space).
( cd "$(dirname "$ISO_OUT")" && sha256sum "$(basename "$ISO_OUT")" > "$(basename "$ISO_OUT").sha256" )

echo "[*] Done: $ISO_OUT"
echo "[*]        $ISO_OUT.sha256"
echo "[*] Verify before USB: qemu-system-x86_64 -m 2G -cdrom \"$ISO_OUT\""
echo "[*] Write to stick:    dd if=\"$ISO_OUT\" of=/dev/sdX bs=4M status=progress conv=fsync"
echo "[*] LUKS persistence:  see BUILD_PLAN.md §5"
