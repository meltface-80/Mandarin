#!/bin/bash
# os/test/bridge-on-box.sh update|report — run on the boot test's box (os/test/bridge-update-vm.sh puts it there, with a
# unit that starts it once Mandarin Bridge has started), where nothing from outside reaches the Bridge's port (the
# firewall): what the Bridge says, in the journal and in the shared folder, where the test reads it.
#   update   the Bridge asked to update to mandarin-bridge-v9.9.9 (POST /update, as Mandarin's Settings → Updates asks
#            it), then watched: "bridge-test: after: {name, version}" once it answers as 9.9.9, "bridge-test: failed:
#            <what it says>" where its update failed
#   report   "bridge-test: running: {name, version}", what it answers as now
B=http://127.0.0.1:49494
# Each line in the journal, and in a log of its own in the shared folder (MandarinOS/Logs), read there by the test.
LOG=/data/MandarinOS/Logs/BridgeTest_log.txt
say() {
  echo "bridge-test: $*"
  echo "$(date -u '+%F %T') $(cat /usr/lib/mandarin-os/VERSION) bridge-test: $*" >> "$LOG" && chgrp mandarin-share "$LOG" && chmod 0640 "$LOG"
}
dac() { curl -fsS --max-time 5 "$B/dac.json" 2>/dev/null; }
for i in $(seq 1 90); do d="$(dac)" && break; sleep 2; done
[ -n "${d:-}" ] || { say "no answer: $(systemctl is-active mandarin-bridge.service)"; exit 1; }
if [ "${1:-}" = report ]; then say "running: $(jq -c '{name, version}' <<< "$d")"; exit 0; fi
say "before: $(jq -c '{name, version}' <<< "$d")"
say "asked: $(curl -sS --max-time 10 -H 'Content-Type: application/json' -d '{"tag":"mandarin-bridge-v9.9.9"}' "$B/update")"
for i in $(seq 1 120); do
  sleep 2
  d="$(dac)" || continue
  case "$(jq -r .version <<< "$d")" in 9.9.9*) say "after: $(jq -c '{name, version}' <<< "$d")"; exit 0 ;; esac
  [ "$(jq -r '.update.state // empty' <<< "$d")" = failed ] && { say "failed: $(jq -r .update.says <<< "$d")"; exit 1; }
done
say "failed: not updated in 4 minutes: $(jq -c '.update' <<< "${d:-null}")"
exit 1
