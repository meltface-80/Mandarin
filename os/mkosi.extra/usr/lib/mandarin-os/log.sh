# /usr/lib/mandarin-os/log.sh — Mandarin OS's lines for Mandarin's one log (item 425), sourced by its scripts: each said
# to the journal as mandarin-os with its level, and mandarin-log.service (the one writer) puts it into
# /data/Logs/Mandarin_log.txt (smb://<box>/Data/Logs) as "[os] …", among Mandarin's and its Bridge's in time order,
# dated in UTC. Before the data partition is there (the installer, from the USB stick), the journal alone.
#   oslog INFO "[usb] mounted /data/Storage/USB/Music SSD (exfat)"
#   some-command 2>&1 | oslog_lines INFO "[bridge]"     each line the command says, a line of the log
oslog() {
  local level="$1"; shift
  logger -t mandarin-os -- "$level $*" 2>/dev/null || true
}
oslog_lines() {
  local level="$1" tag="$2" l
  while IFS= read -r l; do [ -n "${l//[[:space:]]/}" ] && oslog "$level" "$tag $l"; done
  return 0
}
