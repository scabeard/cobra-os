#!/usr/bin/env bash
#
# build-rootfs.sh
# Builds a minimal Debian rootfs and preps it for the Parrot tool repo +
# hardening pass, which happens inside chroot-setup.sh.
#
# Run on a Debian/Ubuntu host with debootstrap, qemu-user-static (if cross-arch),
# and root access. Tested target: amd64, Debian trixie base (Parrot 7 "echo"
# packages are trixie-built — do NOT point this at bookworm).
#
set -euo pipefail

ROOTFS="${ROOTFS:-./rootfs}"
DEBIAN_RELEASE="${DEBIAN_RELEASE:-trixie}"
ARCH="${ARCH:-amd64}"
MIRROR="${MIRROR:-http://deb.debian.org/debian}"

require_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "[-] This script must be run as root (debootstrap + chroot need it)." >&2
    exit 1
  fi
}

require_tools() {
  for tool in debootstrap chroot; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "[-] Missing required tool: $tool" >&2
      echo "    On Debian/Ubuntu: apt install debootstrap" >&2
      exit 1
    }
  done
}

cleanup_mounts() {
  echo "[*] Cleaning up mounts..."
  for m in dev/pts dev proc sys; do
    if mountpoint -q "$ROOTFS/$m" 2>/dev/null; then
      umount -lf "$ROOTFS/$m" || true
    fi
  done
}
trap cleanup_mounts EXIT

require_root
require_tools

if [[ "${SKIP_DEBOOTSTRAP:-0}" == "1" && -x "$ROOTFS/bin/bash" ]]; then
  echo "[*] SKIP_DEBOOTSTRAP=1 — reusing existing rootfs at $ROOTFS (resume mode)"
else
  echo "[*] Debootstrapping minimal Debian base ($DEBIAN_RELEASE, $ARCH)..."
  debootstrap --arch="$ARCH" --variant=minbase "$DEBIAN_RELEASE" "$ROOTFS" "$MIRROR"
fi

echo "[*] Copying resolv.conf so the chroot has DNS..."
# systemd-resolved hosts: /etc/resolv.conf points at the 127.0.0.53 stub,
# which does not exist inside the chroot — DNS would be dead in there.
# Prefer the resolved upstream servers when the stub is detected.
if grep -qE '^nameserver[[:space:]]+127\.0\.0\.53$' /etc/resolv.conf 2>/dev/null \
    && [[ -r /run/systemd/resolve/resolv.conf ]]; then
    echo "[*] systemd-resolved stub detected — using /run/systemd/resolve/resolv.conf"
    cp /run/systemd/resolve/resolv.conf "$ROOTFS/etc/resolv.conf"
else
    cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf"
fi

echo "[*] Mounting virtual filesystems..."
mountpoint -q "$ROOTFS/dev"     || mount --bind /dev "$ROOTFS/dev"
mountpoint -q "$ROOTFS/dev/pts" || mount --bind /dev/pts "$ROOTFS/dev/pts"
mountpoint -q "$ROOTFS/proc"    || mount -t proc proc "$ROOTFS/proc"
mountpoint -q "$ROOTFS/sys"     || mount -t sysfs sysfs "$ROOTFS/sys"

echo "[*] Staging COBRA files (setup script, cobrashell, ops registry)..."
STAGE="$ROOTFS/root/cobra-stage"
# rm -rf first: with SKIP_DEBOOTSTRAP=1 the rootfs is reused, and files retired
# from the repo must not linger in the stage dir (same ISO leak as the
# pre-refactor TUI files in the 2026-08-15 live-build cache, and the retired
# X11/Terminator configs from the 2026-08-16 console-only revert).
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp chroot-setup.sh "$STAGE/chroot-setup.sh"
cp shell/cobrashell.sh "$STAGE/cobrashell.sh"
cp shell/ghostip.sh "$STAGE/ghostip.sh"
cp shell/whatserver.sh "$STAGE/whatserver.sh"
cp shell/mkegg.sh "$STAGE/mkegg.sh"
cp shell/upload_server.php "$STAGE/upload_server.php"
cp shell/linpeas.sh "$STAGE/linpeas.sh"
cp shell/cobra-ops.sh "$STAGE/cobra-ops.sh"
cp shell/cobra-theme.sh "$STAGE/cobra-theme.sh"
cp splash.png "$STAGE/splash.png"

# CobraStrike AI operator (COBRA_PROFILES=ai): stage the pre-built bundles only
# for ai builds so the minimal image never carries the Node stack. chroot-setup
# installs them when the profile is active. Rebuild dist/ first if stale.
if [[ " ${COBRA_PROFILES:-} " == *" ai "* ]]; then
    for b in "CobraStrike/cobra-client/dist/cobra.js" "CobraStrike/cobra-mcp/dist/cobra-mcp.js"; do
        if [[ ! -f "$b" ]]; then
            echo "[!] COBRA_PROFILES=ai but $b is missing — run: (cd CobraStrike/cobra-client && npm run bundle) and (cd CobraStrike/cobra-mcp && npm run bundle)" >&2
            exit 1
        fi
    done
    cp CobraStrike/cobra-client/dist/cobra.js "$STAGE/cobra.js"
    cp CobraStrike/cobra-mcp/dist/cobra-mcp.js "$STAGE/cobra-mcp.js"
    # Doctrine tree the agent reads at runtime: brain (living memory + mission
    # template + playbooks), tradecraft guides, the CobraStrike mkegg variant
    # (payload_egg_build), and the build plan (cobra://buildplan resource).
    # Without these the server's repo-relative path defaults resolve to "/" on
    # an installed box and every knowledge lookup comes back "(not found)".
    cp -r CobraStrike/brain "$STAGE/brain"
    cp -r CobraStrike/tradecraft "$STAGE/tradecraft"
    mkdir -p "$STAGE/cobra-scripts"
    cp CobraStrike/scripts/mkegg.sh "$STAGE/cobra-scripts/mkegg.sh"
    cp CobraStrike/BUILD_PLAN.md "$STAGE/cobra-buildplan.md"
    echo "[*] staged CobraStrike bundles + doctrine tree (ai profile)"
    # Optional operator-key bake (2026-08-23): a local, gitignored key file
    # (secrets/openrouter.key; override with COBRA_OPENROUTER_KEY_FILE) rides
    # the stage dir so chroot-setup.sh can install it as the operator's
    # ~/.config/cobra/credentials (0600) — no typing/pasting long keys into
    # console VMs. Self-built, self-used images ONLY: the squashfs embeds the
    # key in plaintext, so a keyed image must never be distributed. The key's
    # content is never logged.
    COBRA_KEY_FILE="${COBRA_OPENROUTER_KEY_FILE:-secrets/openrouter.key}"
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
    if [[ -f "${COBRA_OPENROUTER_KEY_FILE:-secrets/openrouter.key}" ]]; then
        echo "[!] ${COBRA_OPENROUTER_KEY_FILE:-secrets/openrouter.key} exists but COBRA_PROFILES lacks 'ai' — key NOT staged (no CobraStrike in this image)" >&2
    fi
fi

chmod +x "$STAGE/chroot-setup.sh"

echo "[*] Entering chroot to install Parrot tools + harden..."
# Scrub the host environment: bash auto-sets HOSTNAME (and sudo/chroot pass it
# through), which would silently override chroot-setup.sh's defaults. Only the
# explicit COBRA knobs below cross the chroot boundary.
CHROOT_ENV=(
  HOME=/root
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  TERM="${TERM:-dumb}"
  DEBIAN_FRONTEND=noninteractive
)
[[ -n "${PARROT_SUITE:-}" ]]   && CHROOT_ENV+=("PARROT_SUITE=$PARROT_SUITE")
[[ -n "${COBRA_HOSTNAME:-}" ]] && CHROOT_ENV+=("COBRA_HOSTNAME=$COBRA_HOSTNAME")
[[ -n "${OPERATOR_USER:-}" ]]  && CHROOT_ENV+=("OPERATOR_USER=$OPERATOR_USER")
[[ -n "${COBRA_PROFILES:-}" ]] && CHROOT_ENV+=("COBRA_PROFILES=$COBRA_PROFILES")
chroot "$ROOTFS" env -i "${CHROOT_ENV[@]}" /root/cobra-stage/chroot-setup.sh

rm -rf "$STAGE"

echo "[*] Done. Minimal rootfs with Parrot tools is ready at: $ROOTFS"
echo "[*] Next: build a bootable image (see README.md for the QEMU / ISO steps)."
