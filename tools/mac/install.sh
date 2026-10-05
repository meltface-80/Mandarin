#!/bin/bash
#
# Mandarin for macOS: the one-line installer.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/meltface-80/Mandarin/main/tools/mac/install.sh)"
#
# Installs Homebrew (if it isn't there), Node.js 22 and ffmpeg, downloads
# Mandarin into ~/Mandarin, asks with the Mac's own Finder windows where the
# music is (and where to keep the MusicBrainz pack, if anywhere else), starts
# Mandarin now and at every login, and opens it in the browser. Run it again
# to choose other folders; it keeps the library, the account and the settings.
set -euo pipefail

APP_DIR="$HOME/Mandarin"
LABEL="app.mandarin.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="https://github.com/meltface-80/Mandarin.git"
PORT=3500

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
# XML-safe text for the launch file.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

if [ "$(uname)" != "Darwin" ]; then echo "This installer is for macOS. On Linux, use Docker (see the README)."; exit 1; fi

say "Installing Mandarin. This takes a few minutes; leave this window open."

# 1. Homebrew, the Mac's package installer.
use_brew() { for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do if [ -x "$b" ]; then eval "$("$b" shellenv)"; return 0; fi; done; return 1; }
if ! command -v brew >/dev/null 2>&1 && ! use_brew; then
  say "First, Homebrew. When it asks for a password, type your Mac's password (nothing shows as you type) and press Return."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  use_brew || { echo "Homebrew didn't install. Run this line again."; exit 1; }
fi
BREW="$(brew --prefix)"

# 2. Node.js 22 and ffmpeg.
say "Installing Node.js and ffmpeg…"
brew install node@22 ffmpeg
NODE_BIN="$BREW/opt/node@22/bin"
export PATH="$NODE_BIN:$BREW/bin:$PATH"

# 3. Mandarin itself (stopped first if this is a second run).
launchctl unload "$PLIST" 2>/dev/null || true
if [ ! -f "$APP_DIR/launcher.js" ]; then
  say "Downloading Mandarin…"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
say "Setting Mandarin up…"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
mkdir -p "$APP_DIR/data"

# 4. Where the music is: the Finder's own folder chooser.
say "Choose your music folder in the window that opens."
MUSIC="$(osascript -e 'POSIX path of (choose folder with prompt "Choose the folder your music is in:" default location (path to music folder))' 2>/dev/null || true)"
MUSIC="${MUSIC%/}"
[ -n "$MUSIC" ] || MUSIC="$HOME/Music"

# 5. Where the MusicBrainz pack goes, if it's downloaded later (Settings → Library Scanner).
PACK=""
WHERE="$(osascript -e 'button returned of (display dialog "If you download the MusicBrainz pack later (optional, about 2 GB, it helps name your albums), where should it be kept?" buttons {"Choose a folder...", "On this Mac"} default button "On this Mac" with title "Mandarin")' 2>/dev/null || echo "On this Mac")"
if [ "$WHERE" != "On this Mac" ]; then
  PACK="$(osascript -e 'POSIX path of (choose folder with prompt "Choose a folder for the MusicBrainz pack:")' 2>/dev/null || true)"
  PACK="${PACK%/}"
fi

# 6. Keep the Mac awake while plugged in (asks for the password in a window of its own).
AWAKE="$(osascript -e 'button returned of (display dialog "Keep this Mac awake while it is plugged in, so the music does not stop? The screen can still turn off. (Recommended)" buttons {"No", "Keep awake"} default button "Keep awake" with title "Mandarin")' 2>/dev/null || echo "No")"
if [ "$AWAKE" = "Keep awake" ]; then
  osascript -e 'do shell script "pmset -c sleep 0" with administrator privileges' >/dev/null 2>&1 || echo "Couldn't change the sleep setting; do it in System Settings → Energy."
fi

# 7. Start Mandarin now and at every login.
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo '<plist version="1.0"><dict>'
  echo "  <key>Label</key><string>$LABEL</string>"
  echo "  <key>ProgramArguments</key><array><string>$(xml "$NODE_BIN/node")</string><string>$(xml "$APP_DIR/launcher.js")</string></array>"
  echo "  <key>WorkingDirectory</key><string>$(xml "$APP_DIR")</string>"
  echo '  <key>EnvironmentVariables</key><dict>'
  echo "    <key>MUSIC_DIR</key><string>$(xml "$MUSIC")</string>"
  [ -n "$PACK" ] && echo "    <key>MBPACK_DIR</key><string>$(xml "$PACK")</string>"
  echo "    <key>PORT</key><string>$PORT</string>"
  echo "    <key>MANDARIN_LAUNCHD</key><string>$LABEL</string>"
  echo "    <key>PATH</key><string>$(xml "$NODE_BIN:$BREW/bin:/usr/bin:/bin")</string>"
  echo '  </dict>'
  echo '  <key>RunAtLoad</key><true/>'
  echo '  <key>KeepAlive</key><true/>'
  echo "  <key>StandardOutPath</key><string>$(xml "$APP_DIR/data/server.log")</string>"
  echo "  <key>StandardErrorPath</key><string>$(xml "$APP_DIR/data/server.log")</string>"
  echo '</dict></plist>'
} > "$PLIST"
launchctl load "$PLIST"

# 8. The Mandarin icon (v0.6.12), on the desktop and in Applications: it starts
#    Mandarin again after Settings → Restart & shut down → Shut down (loading the
#    login item), then opens it in the browser. Running already, it just opens it.
say "Adding the Mandarin icon to your desktop…"
ICON_APP="$HOME/Applications/Mandarin.app"
mkdir -p "$HOME/Applications"
rm -rf "$ICON_APP"
SCRIPT="$(mktemp "${TMPDIR:-/tmp}/mandarin.XXXXXX")"
cat > "$SCRIPT" <<APPLESCRIPT
set plistPath to (POSIX path of (path to home folder)) & "Library/LaunchAgents/$LABEL.plist"
try
  do shell script "launchctl load -w " & quoted form of plistPath & " >/dev/null 2>&1; launchctl start $LABEL >/dev/null 2>&1; for i in \$(seq 1 60); do curl -fs http://localhost:$PORT/api/health >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1"
  open location "http://localhost:$PORT"
on error
  display dialog "Mandarin didn't start. What it said is in ~/Mandarin/data/server.log" buttons {"OK"} default button "OK" with title "Mandarin"
end try
APPLESCRIPT
if osacompile -o "$ICON_APP" "$SCRIPT" 2>/dev/null; then
  # Mandarin's own icon on it, made from the app's 512px icon.
  SET="$(mktemp -d)/Mandarin.iconset"
  mkdir -p "$SET"
  SRC="$APP_DIR/public/icons/icon-512.png"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
    d=$((s * 2))
    if [ "$d" -le 512 ]; then sips -z "$d" "$d" "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true; fi
  done
  iconutil -c icns "$SET" -o "$ICON_APP/Contents/Resources/applet.icns" 2>/dev/null || true
  touch "$ICON_APP"
  ln -sfn "$ICON_APP" "$HOME/Desktop/Mandarin" 2>/dev/null || echo "Couldn't put the icon on the desktop; it's in your Applications folder (Home → Applications)."
else
  echo "Couldn't make the Mandarin icon; Mandarin still starts when you log in."
fi
rm -f "$SCRIPT"

say "Starting Mandarin…"
up=""
for _ in $(seq 1 60); do
  if curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
if [ -z "$up" ]; then
  echo "Mandarin didn't start. What it said is in $APP_DIR/data/server.log"
  exit 1
fi
open "http://localhost:$PORT"

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
say "Mandarin is running."
echo "  On this Mac:   http://localhost:$PORT"
[ -n "$IP" ] && echo "  On your phone: http://$IP:$PORT"
echo "  Music folder:  $MUSIC  (add more in Settings → Music Folders)"
[ -n "$PACK" ] && echo "  Pack folder:   $PACK"
echo
echo "Create your account in the browser window that opened. Mandarin starts by itself"
echo "whenever you log in, and the Mandarin icon on your desktop starts it after a Shut down."
echo "Add or change music folders any time in Settings → Music Folders."
echo "If macOS asks to let \"node\" find devices on your network or open your files, choose Allow."
