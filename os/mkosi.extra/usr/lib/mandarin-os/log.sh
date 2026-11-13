# /usr/lib/mandarin-os/log.sh — Mandarin OS's own log (item 389), sourced by its scripts: MandarinOS_log.txt in
# /data/MandarinOS/Logs (smb://mandarin/data/MandarinOS/Logs), rolled at 4 MB into .01 to .10, each line dated in UTC
# with its level and where it came from, as Mandarin's server writes its own; journald has each line too. Before the
# data partition is there (the installer, from the USB stick), journald alone.
#   oslog INFO "[usb] mounted /data/Storage/USB/Music SSD (exfat)"
OSLOG_DIR="${MANDARIN_OS_ROOT:-}/data/MandarinOS/Logs"   # under the tests' own root, where they give one
OSLOG_FILE="$OSLOG_DIR/MandarinOS_log.txt"
oslog() {
  local level="$1"; shift
  local line
  line="$(date -u '+%Y-%m-%d %H:%M:%S.%3N') UTC  $(printf '%-5s' "$level")  $*"
  logger -t mandarin-os -- "$level $*" 2>/dev/null || true
  mountpoint -q "${MANDARIN_OS_ROOT:-}/data" 2>/dev/null || return 0
  mkdir -p "$OSLOG_DIR" 2>/dev/null || return 0
  if [ -f "$OSLOG_FILE" ] && [ "$(stat -c %s "$OSLOG_FILE" 2>/dev/null || echo 0)" -gt 4194304 ]; then
    rm -f "$OSLOG_DIR/MandarinOS_log.10.txt"
    for n in 9 8 7 6 5 4 3 2 1; do
      [ -f "$OSLOG_DIR/MandarinOS_log.0$n.txt" ] && mv -f "$OSLOG_DIR/MandarinOS_log.0$n.txt" "$OSLOG_DIR/MandarinOS_log.$(printf '%02d' $((n + 1))).txt"
    done
    mv -f "$OSLOG_FILE" "$OSLOG_DIR/MandarinOS_log.01.txt"
  fi
  if [ ! -s "$OSLOG_FILE" ]; then
    printf '# Mandarin OS %s log, begun %s UTC\n# Time zone: %s; every time below is UTC\n' \
      "$(cat /usr/lib/mandarin-os/VERSION 2>/dev/null || echo '?')" "$(date -u '+%Y-%m-%d %H:%M:%S')" "$(cat /etc/timezone 2>/dev/null || echo UTC)" >> "$OSLOG_FILE"
  fi
  printf '%s\n' "$line" >> "$OSLOG_FILE"
}
