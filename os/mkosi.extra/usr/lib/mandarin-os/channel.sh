# /usr/lib/mandarin-os/channel.sh — which builds of Mandarin this box installs (item 405), sourced by reinstall-mandarin
# and apply: Mandarin's releases ("latest"), or dev's builds ("dev": the test-server pre-release). The shared folder's
# Installer (smb://<box>/data/Installer, /data/Installer; in Storage until 0.1.6, item 406) says which is wanted, once:
# a file in it whose name starts with "dev", in any case (dev, dev.bin, DEV.txt), is dev; one starting with "latest" is
# latest (latest.bin); neither, the channel the box is on now. The file is spent once Mandarin is installed from it
# (taken away, item 406), so the box stays where it was put, the upkeep's own reinstalls included. Reinstall Mandarin installs from it and keeps it in MachineSettings/mandarin-channel.env on the
# data partition, which mandarin.service reads (mandarin.service.d/mandarin-os.conf), so Mandarin's own updates
# (Settings → Updates) follow it too until the next Reinstall; on the data partition, Mandarin OS's own updates leave it
# as it is. Only Mandarin follows it: Mandarin OS and Mandarin Bridge stay on their releases.
CHANNEL_DIR="${MANDARIN_OS_ROOT:-}/data/Installer"
CHANNEL_OLD="${MANDARIN_OS_ROOT:-}/data/Storage/Installer"
CHANNEL_SHARE="${MANDARIN_OS_ROOT:-}/data/Share/Installer"
CHANNEL_FILE="${MANDARIN_OS_ROOT:-}/data/MachineSettings/mandarin-channel.env"

# The file in Installer asking for [prefix] (dev or latest), if there is one.
channel_asked() {
  local f
  for f in "$CHANNEL_DIR"/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f" | tr '[:upper:]' '[:lower:]')" in "$1"*) echo "$f"; return 0 ;; esac
  done
  return 1
}

# What Installer asks for: latest, dev, or (neither) the channel now. latest.bin wins over dev.bin, the safer of them.
channel_wanted() {
  if channel_asked latest >/dev/null; then echo latest
  elif channel_asked dev >/dev/null; then echo dev
  else channel_now; fi
}

# The files that asked spent (taken away, with a Mac's ._ beside them), once Mandarin is installed from them.
channel_spend() {
  local f
  for p in latest dev; do
    while f="$(channel_asked "$p")"; do rm -f "$f" "$(dirname "$f")/._$(basename "$f")" || return 1; done
  done
}

# What Mandarin was last installed from (latest where it was never said).
channel_now() {
  [ "$(sed -n 's/^MANDARIN_CHANNEL=//p' "$CHANNEL_FILE" 2>/dev/null)" = dev ] && echo dev || echo latest
}

# [channel] kept for mandarin.service.
channel_keep() {
  mkdir -p "$(dirname "$CHANNEL_FILE")" && printf 'MANDARIN_CHANNEL=%s\n' "$1" > "$CHANNEL_FILE.new" && mv -f "$CHANNEL_FILE.new" "$CHANNEL_FILE"
}

# The channel in words, for the log.
channel_words() { [ "$1" = dev ] && echo "development builds" || echo "the latest release"; }

# Installer made, as Storage is (apply): on the data partition, at the top of the share beside Storage (a link, as
# Storage is), the share's user's ([user]) and Mandarin's group's, written by both, with one line in it saying what it
# is for. One in Storage (0.1.5) is moved here, what was put in it kept, and taken away.
channel_folder() {
  mkdir -p "$CHANNEL_DIR" || return 1
  if [ -d "$CHANNEL_OLD" ] && [ ! -L "$CHANNEL_OLD" ]; then
    local f
    for f in "$CHANNEL_OLD"/* "$CHANNEL_OLD"/.[!.]*; do
      [ -e "$f" ] || continue
      [ "$(basename "$f")" = README.txt ] && { rm -f "$f"; continue; }
      [ -e "$CHANNEL_DIR/$(basename "$f")" ] && rm -rf "$f" || mv "$f" "$CHANNEL_DIR/"
    done
    rmdir "$CHANNEL_OLD" 2>/dev/null
  fi
  mkdir -p "$(dirname "$CHANNEL_SHARE")" && ln -sfn /data/Installer "$CHANNEL_SHARE"
  [ -e "$CHANNEL_DIR/README.txt" ] || echo "Used by Mandarin's reinstaller. Leave it as it is." > "$CHANNEL_DIR/README.txt"
  chown "${1:-root}:mandarin" "$CHANNEL_DIR" "$CHANNEL_DIR/README.txt"
  chmod 2775 "$CHANNEL_DIR"
  chmod 0664 "$CHANNEL_DIR/README.txt"
}
