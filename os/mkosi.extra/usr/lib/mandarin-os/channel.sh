# /usr/lib/mandarin-os/channel.sh — which builds of Mandarin this box installs (item 405), sourced by reinstall-mandarin
# and apply: Mandarin's releases ("latest"), or dev's builds ("dev": the test-server pre-release). The shared folder's
# Storage/Installer says which is wanted: a file in it whose name starts with "dev", in any case (dev, dev.bin, DEV.txt),
# is dev; none is latest. Reinstall Mandarin installs from it and keeps it in MachineSettings/mandarin-channel.env on the
# data partition, which mandarin.service reads (mandarin.service.d/mandarin-os.conf), so Mandarin's own updates
# (Settings → Updates) follow it too until the next Reinstall; on the data partition, Mandarin OS's own updates leave it
# as it is. Only Mandarin follows it: Mandarin OS and Mandarin Bridge stay on their releases.
CHANNEL_DIR="${MANDARIN_OS_ROOT:-}/data/Storage/Installer"
CHANNEL_FILE="${MANDARIN_OS_ROOT:-}/data/MachineSettings/mandarin-channel.env"

# What Storage/Installer asks for: dev or latest.
channel_wanted() {
  local f
  for f in "$CHANNEL_DIR"/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f" | tr '[:upper:]' '[:lower:]')" in dev*) echo dev; return ;; esac
  done
  echo latest
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

# Storage/Installer made, as Storage is (apply): the share's user's ([user]) and Mandarin's group's, written by both,
# with one line in it saying what it is for.
channel_folder() {
  mkdir -p "$CHANNEL_DIR" || return 1
  [ -e "$CHANNEL_DIR/README.txt" ] || echo "Used by Mandarin's reinstaller. Leave it as it is." > "$CHANNEL_DIR/README.txt"
  chown "${1:-root}:mandarin" "$CHANNEL_DIR" "$CHANNEL_DIR/README.txt"
  chmod 2775 "$CHANNEL_DIR"
  chmod 0664 "$CHANNEL_DIR/README.txt"
}
