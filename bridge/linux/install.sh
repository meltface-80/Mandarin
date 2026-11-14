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
  # Tried again (item 380): GitHub's download service answers 502 or 504 now and then for a file that is there.
  n=0
  until curl -fsSL --connect-timeout 20 "$RELEASES/mandarin-bridge-linux-$ARCH.tar.gz" -o "$TMP/bridge.tar.gz"; do
    n=$((n + 1))
    [ "$n" -lt 5 ] || { echo "Mandarin Bridge couldn't be downloaded from GitHub (5 tries); try again in a few minutes." >&2; exit 1; }
    echo "GitHub didn't send it; trying again ($n of 4)…"
    sleep $((n * 3))
  done
fi
tar -xzf "$TMP/bridge.tar.gz" -C "$TMP"
command -v ffmpeg >/dev/null 2>&1 || { echo "Installing ffmpeg…"; apt-get update -q && apt-get install -y -q --no-install-recommends ffmpeg; }
mkdir -p /usr/lib/mandarin-bridge
install -m 755 "$TMP/mandarin-bridge/mandarin-bridge" "$TMP/mandarin-bridge/mandarin-audio" /usr/lib/mandarin-bridge/
# Its own user and group (item 415), kept where they are (Mandarin OS makes them, numbered the same in every version).
# It ran as a DynamicUser before: from systemd 256 nothing in a DynamicUser's data folder can be run, its update
# included. systemd moves that data folder back from /var/lib/private as the service starts, and the service makes it
# the Bridge's: who it is to Mandarin, its settings and its logs kept.
if ! id -u mandarin-bridge >/dev/null 2>&1; then
  getent group mandarin-bridge >/dev/null 2>&1 || groupadd --system mandarin-bridge
  useradd --system --gid mandarin-bridge --no-create-home --home-dir /var/lib/mandarin-bridge --shell /usr/sbin/nologin mandarin-bridge
fi
install -m 644 "$TMP/mandarin-bridge/mandarin-bridge.service" /etc/systemd/system/mandarin-bridge.service
# An update the Bridge fetched itself (its data folder's app/, run in place of the program installed) gives way to the
# program installed now (item 385): left there, the Bridge went on running it. Its data folder is systemd's, under
# /var/lib/private where it ran as a DynamicUser (before 0.3.12).
rm -rf /var/lib/mandarin-bridge/app /var/lib/private/mandarin-bridge/app
systemctl daemon-reload
systemctl enable mandarin-bridge >/dev/null 2>&1
systemctl restart mandarin-bridge
ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "Mandarin Bridge $(/usr/lib/mandarin-bridge/mandarin-bridge --version | cut -d' ' -f2) is running: its page is at http://${ADDR:-this-computer}:49494/"
echo "Mandarin finds it on the network by itself: switch it on in Settings → Audio Devices."
