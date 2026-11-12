#!/bin/bash
#
# Mandarin on Linux without Docker: the one-line installer (Debian, Ubuntu, Raspberry Pi OS; x64 or arm64).
#
#   curl -fsSL https://raw.githubusercontent.com/meltface-80/Mandarin/main/tools/linux/install.sh | sudo bash -s -- --music /srv/music
#
# Installs what Mandarin needs from apt (ffmpeg, poppler, Python with numpy for SQ-tool, ICU), makes a user of its own
# (mandarin, in the audio group, so a DAC plugged into this computer plays), downloads the latest release's page and
# this machine's server, each checked against Mandarin's release key, into /opt/mandarin, keeps its data in
# /var/lib/mandarin, and runs it as a systemd service (mandarin.service) now and at every start. Run it again to update
# or to choose another music folder: the library, the account and the settings are kept. After that it updates itself
# from Settings → Updates, as Docker's does.
#
#   --music DIR    the music folder (asked for, or /music, where not given); more can be added in Settings
#   --port N       the port (3500)
#   --uninstall    the service and /opt/mandarin removed; the data kept in /var/lib/mandarin (--purge: that too)
#   --data DIR     the data folder (/var/lib/mandarin): Mandarin OS keeps it on its data partition
#   --no-start     the service enabled, not started (Mandarin OS's image, built where nothing runs)
#   --no-apt       nothing installed from apt (Mandarin OS's image lists what it needs itself)
#
# Mandarin OS installs Mandarin with this (item 389's plan, phase 2).
set -euo pipefail

ROOT="${MANDARIN_ROOT:-}"                     # the tests' own root: everything below it
APP_DIR="$ROOT/opt/mandarin"
DATA="/var/lib/mandarin"
UNIT="$ROOT/etc/systemd/system/mandarin.service"
USER_NAME=mandarin
API="${MANDARIN_API:-https://api.github.com/repos/meltface-80/Mandarin}"
RELEASES="${MANDARIN_RELEASES:-https://github.com/meltface-80/Mandarin/releases/download}"
# Mandarin's release key, its public half (server/Mandarin.Server/Admin/ReleaseKey.cs): the page and the server are
# taken only signed with it. MANDARIN_RELEASE_KEY names another (the tests').
KEY="${MANDARIN_RELEASE_KEY:-MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWPo7em6WGTi2IICIB2POcOia7Hc/jFNK6MPlL1MQn4huS0EYMTfqkpxyaqL8hXOk297sBISqi0j463Tr+NZFXQ==}"
PORT=3500
MUSIC=""
UNINSTALL=0
PURGE=0
START=1
APT=1

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --music) MUSIC="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) UNINSTALL=1; PURGE=1; shift ;;
    --data) DATA="${2:-}"; shift 2 ;;
    --no-start) START=0; shift ;;
    --no-apt) APT=0; shift ;;
    *) die "No option $1: --music DIR, --port N, --data DIR, --no-start, --no-apt, --uninstall, --purge" ;;
  esac
done
case "$DATA" in /*) ;; *) die "--data is a whole path (/data/MandarinServer)" ;; esac
DATA_DIR="$ROOT$DATA"
case "$PORT" in ''|*[!0-9]*) die "--port is a number" ;; esac

[ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || die "Run it as root: … | sudo bash"
[ "$(uname -s)" = Linux ] || die "This installer is for Linux."

if [ "$UNINSTALL" = 1 ]; then
  say "Removing Mandarin…"
  systemctl disable --now mandarin.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl daemon-reload 2>/dev/null || true
  rm -rf "$APP_DIR"
  if [ "$PURGE" = 1 ]; then rm -rf "$DATA_DIR"; echo "Removed, its data too."; else echo "Removed. Its data is kept in $DATA_DIR (--purge removes it)."; fi
  exit 0
fi

case "$(uname -m)" in x86_64|amd64) RID=linux-x64 ;; aarch64|arm64) RID=linux-arm64 ;; *) die "Mandarin runs on 64-bit Intel/AMD or ARM; this is $(uname -m)." ;; esac

# The key as openssl reads it.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
{ echo "-----BEGIN PUBLIC KEY-----"; printf '%s\n' "$KEY" | fold -w 64; echo "-----END PUBLIC KEY-----"; } > "$TMP/key.pem"

# [file] signed with the release key ([file].sig beside it, DER, as .github/sign.sh makes it).
signed() { openssl dgst -sha256 -verify "$TMP/key.pem" -signature "$1.sig" "$1" >/dev/null 2>&1; }
get() { curl -fsSL --retry 3 -o "$2" "$1"; }

# 1. What Mandarin needs (the Docker image's own list, Dockerfile).
if [ "$APT" = 1 ]; then
  say "Installing ffmpeg, poppler, Python and ICU…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  ICU="$(apt-cache pkgnames libicu 2>/dev/null | grep -E '^libicu[0-9]+$' | sort -V | tail -n 1 || true)"
  apt-get install -y -q --no-install-recommends ffmpeg poppler-utils python3 python3-numpy curl ca-certificates openssl ${ICU:+"$ICU"}
fi

# 2. The latest release, checked.
# The latest release's version: where its page leads (…/releases/tag/v1.3.0), else GitHub's API (rate-limited per address).
latest() {
  curl -fsSIL --retry 3 -o /dev/null -w '%{url_effective}' "${RELEASES%/download}/latest" 2>/dev/null | sed -n 's|.*/releases/tag/v\{0,1\}\([^/]*\)$|\1|p'
}
VERSION="${MANDARIN_VERSION:-$(latest)}"
[ -n "$VERSION" ] || VERSION="$(curl -fsSL --retry 3 "$API/releases/latest" | sed -n 's/^ *"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$VERSION" ] || die "Couldn't find Mandarin's latest release. Check the connection and run it again."
say "Downloading Mandarin $VERSION ($RID)…"
B="musicd-server-$VERSION.tar.gz" S="mandarin-server-$RID.gz"
for f in "$B" "$B.sig" "$S" "$S.sig"; do get "$RELEASES/v$VERSION/$f" "$TMP/$f" || die "Mandarin $VERSION's $f couldn't be downloaded. Check the connection and run it again."; done
signed "$TMP/$B" || die "Mandarin $VERSION's page isn't signed with Mandarin's release key: not installed."
signed "$TMP/$S" || die "Mandarin $VERSION's server isn't signed with Mandarin's release key: not installed."
tar -xzf "$TMP/$B" -C "$TMP" && [ -f "$TMP/musicd-server/package.json" ] || die "Mandarin $VERSION's page is broken: not installed."
gunzip -c "$TMP/$S" > "$TMP/mandarin-server" && chmod 755 "$TMP/mandarin-server"
[ "$("$TMP/mandarin-server" --version 2>/dev/null || true)" = "$VERSION" ] || die "Mandarin $VERSION's server doesn't run on this machine: not installed."

# 3. Its own user, in the audio group (a DAC on this computer), and its folders.
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin --groups audio "$USER_NAME"
fi
systemctl stop mandarin.service 2>/dev/null || true
mkdir -p "$APP_DIR/server/bin" "$DATA_DIR"
rm -rf "$APP_DIR/public"
cp -R "$TMP/musicd-server/." "$APP_DIR/"
mv -f "$TMP/mandarin-server" "$APP_DIR/server/bin/mandarin-server"
echo "$VERSION" > "$APP_DIR/server/bin/mandarin-server.version"
# Its own, so it updates itself from Settings → Updates (the program swapped in place, the page laid over it).
chown -R "$USER_NAME:" "$APP_DIR" "$DATA_DIR"

# 4. The music folder: given, asked for, or as it was.
WAS="$(sed -n 's/^Environment=MUSIC_DIR=//p' "$UNIT" 2>/dev/null || true)"
if [ -z "$MUSIC" ] && [ -t 0 ]; then
  read -r -p "Your music folder [${WAS:-/music}]: " MUSIC || true
fi
MUSIC="${MUSIC:-${WAS:-/music}}"
MUSIC="${MUSIC%/}"
[ -d "$ROOT$MUSIC" ] || echo "Note: $MUSIC isn't there yet. Mandarin waits for it (a drive mounted later is found)."
# The groups that own it, as the Docker image keeps them (item 386): readable as its owner shares it, never root's.
for g in $(stat -c %g "$ROOT$MUSIC" "$ROOT$MUSIC"/* 2>/dev/null | sort -u); do
  [ "$g" = 0 ] && continue
  name="$(getent group "$g" | cut -d: -f1 || true)"
  [ -n "$name" ] && usermod -a -G "$name" "$USER_NAME" 2>/dev/null || true
done

# 5. The service: started now and with the computer; started again if it fails, never after Shut down in Settings
#    (which ends it with 0). Exit 76: a restart that couldn't be done in place (Server.cs), so systemd does it.
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<EOF
[Unit]
Description=Mandarin, a music server
Wants=network-online.target
After=network-online.target local-fs.target

[Service]
User=$USER_NAME
Environment=MANDARIN_APP_DIR=/opt/mandarin
Environment=DATA_DIR=$DATA
Environment=MUSIC_DIR=$MUSIC
Environment=PORT=$PORT
Environment=MANDARIN_SYSTEMD=mandarin.service
ExecStart=/opt/mandarin/server/bin/mandarin-server
Restart=on-failure
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_SYS_NICE
LimitRTPRIO=95
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
if [ "$START" = 0 ]; then
  systemctl enable mandarin.service
  say "Mandarin $VERSION is installed; it starts with the computer."
  exit 0
fi
systemctl daemon-reload
systemctl enable --now mandarin.service

say "Mandarin $VERSION is running."
echo "Open http://$(hostname -I 2>/dev/null | awk '{ print $1 }' || echo localhost):$PORT in a browser to set it up."
echo "Its log: $DATA_DIR/Logs (and Settings → Setup → Logs). Updates: Settings → Updates."
