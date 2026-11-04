#!/bin/sh
# Mandarin Bridge for Linux (item 282): installs the Bridge and the audio engine it plays with, and starts it at boot.
#
#   curl -fsSL https://github.com/meltface-80/Mandarin/releases/download/test-bridge/install.sh | sudo sh
#   sudo sh install.sh mandarin-bridge-linux-arm64.tar.gz      (a package already downloaded)
#
# For a Debian, Ubuntu or Raspberry Pi OS computer (64-bit, x64 or arm64) with systemd; ffmpeg is installed with apt
# where it isn't here. Its page is then at http://<this computer>:49494/.
set -e
[ "$(id -u)" = 0 ] || { echo "Run it as root (sudo sh install.sh)." >&2; exit 1; }
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "A 64-bit computer is needed (this is $(uname -m))." >&2; exit 1 ;; esac
RELEASES=${MANDARIN_BRIDGE_RELEASES:-https://github.com/meltface-80/Mandarin/releases/download/test-bridge}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -n "$1" ]; then cp "$1" "$TMP/bridge.tar.gz"; else
  echo "Downloading Mandarin Bridge for linux-$ARCH…"
  curl -fsSL "$RELEASES/mandarin-bridge-linux-$ARCH.tar.gz" -o "$TMP/bridge.tar.gz"
fi
tar -xzf "$TMP/bridge.tar.gz" -C "$TMP"
command -v ffmpeg >/dev/null 2>&1 || { echo "Installing ffmpeg…"; apt-get update -q && apt-get install -y -q --no-install-recommends ffmpeg; }
mkdir -p /usr/lib/mandarin-bridge
install -m 755 "$TMP/mandarin-bridge/mandarin-bridge" "$TMP/mandarin-bridge/mandarin-audio" /usr/lib/mandarin-bridge/
install -m 644 "$TMP/mandarin-bridge/mandarin-bridge.service" /etc/systemd/system/mandarin-bridge.service
systemctl daemon-reload
systemctl enable mandarin-bridge >/dev/null 2>&1
systemctl restart mandarin-bridge
ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "Mandarin Bridge $(/usr/lib/mandarin-bridge/mandarin-bridge --version | cut -d' ' -f2) is running: its page is at http://${ADDR:-this-computer}:49494/"
echo "Mandarin finds it on the network by itself: switch it on in Settings → Audio Devices."
