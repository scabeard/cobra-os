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
