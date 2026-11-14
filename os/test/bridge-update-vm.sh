# os/test/bridge-update-vm.sh — sourced by boot-test.sh: Mandarin Bridge updating itself on Mandarin OS (item 415), end
# to end, with its W, HERE, fail, ok, part and BRIDGES (os/test/next-bridge.sh's: installed/ and next/, each a Bridge
# and its audio engine). No DAC is needed: the update is the Bridge's own, whatever it plays to.
#   bridge_update_prepare  after the install, before the first start, into the test's own copy of the installed disk
#                          (never the image): the Bridge installed as a box Mandarin OS carried from an earlier version
#                          has it, its program in /usr/lib/mandarin-bridge and the service install.sh installed before
#                          0.3.12 (a DynamicUser's, os/test/mandarin-bridge-0.3.11.service), its data folder as systemd
#                          257 left a DynamicUser's (in /var/lib/private, nobody's, who it is to Mandarin in it), told to
#                          ask a stand-in GitHub on this computer (os/test/fake-bridge-release.js, offering 9.9.9 signed
#                          with a key of the test's own) by a drop-in of the test's; and os/test/bridge-on-box.sh to ask
#                          it to update once it runs (nothing from outside reaches its port: the firewall).
#   bridge_update_check    the box running: the Bridge updated itself to 9.9.9 and started again as it, its name kept.
#   bridge_report_into     into a system mounted at $1 (the next Mandarin OS, os-update-vm.sh's 9.9.9): what the Bridge
#                          answers as, said at each start.
#   bridge_after_os_update after Mandarin OS updated in place: the Bridge still 9.9.9, its name kept (its data folder
#                          and its update carried, its own still, and run).
BRIDGE_NAME="Kept Bridge"

# A unit of the test's own in the system at $1, running os/test/bridge-on-box.sh $2 once the Bridge has started.
bridge_on_box() {
  install -D -m 755 "$HERE/bridge-on-box.sh" "$1/usr/lib/mandarin-os-test/bridge-on-box.sh" || return 1
  printf '[Unit]\nAfter=mandarin-bridge.service mandarin-os-apply.service\nRequiresMountsFor=/data\n[Service]\nType=oneshot\nExecStart=/usr/lib/mandarin-os-test/bridge-on-box.sh %s\n[Install]\nWantedBy=multi-user.target\n' "$2" \
    > "$1/etc/systemd/system/bridge-test-$2.service" || return 1
  mkdir -p "$1/etc/systemd/system/multi-user.target.wants" && ln -sfn "../bridge-test-$2.service" "$1/etc/systemd/system/multi-user.target.wants/bridge-test-$2.service"
}
bridge_report_into() { bridge_on_box "$1" report || fail "the Bridge's report not put into the next Mandarin OS"; }

bridge_update_prepare() {
  local lo rs rn r="$W/root" s
  node "$HERE/fake-bridge-release.js" "$BRIDGES/next" "$W/bridgerel" > "$W/bridgerel.log" 2>&1 & echo $! > "$W/bridgerel.pid"
  for i in $(seq 1 30); do [ -s "$W/bridgerel/port" ] && break; sleep 1; done
  [ -s "$W/bridgerel/port" ] || fail "the stand-in GitHub for Mandarin Bridge didn't start: $(cat "$W/bridgerel.log")"
  read -r rs rn < <(part "$W/disk.raw" "mandarin-os_$V")
  lo="$(losetup -f --show -o $((rs * 512)) --sizelimit $((rn * 512)) "$W/disk.raw")" || fail "no loop device for the installed system"
  mkdir -p "$r" && mount "$lo" "$r" || { losetup -d "$lo"; fail "the installed system's partition didn't mount"; }
  s="$r/etc/systemd/system"
  install -D -m 755 -t "$r/usr/lib/mandarin-bridge" "$BRIDGES/installed/mandarin-bridge" "$BRIDGES/installed/mandarin-audio" \
    && install -m 644 "$HERE/mandarin-bridge-0.3.11.service" "$s/mandarin-bridge.service" \
    && mkdir -p "$s/multi-user.target.wants" "$s/mandarin-bridge.service.d" \
    && ln -sfn ../mandarin-bridge.service "$s/multi-user.target.wants/mandarin-bridge.service" \
    && printf '[Service]\nExecStart=\nExecStart=/usr/lib/mandarin-bridge/mandarin-bridge --data /var/lib/mandarin-bridge --engine /usr/lib/mandarin-bridge/mandarin-audio --update-api http://10.0.2.2:%s\nEnvironment=UPDATE_KEY=%s\n' \
      "$(cat "$W/bridgerel/port")" "$(cat "$W/bridgerel/update.pub")" > "$s/mandarin-bridge.service.d/zz-update-test.conf" \
    && install -d -m 0700 "$r/var/lib/private" && install -d -m 0755 -o 65534 -g 65534 "$r/var/lib/private/mandarin-bridge" \
    && printf '{\n  "name": "%s",\n  "udn": "uuid:00000415-0000-4000-8000-000000000415"\n}' "$BRIDGE_NAME" > "$r/var/lib/private/mandarin-bridge/settings.json" \
    && chown 65534:65534 "$r/var/lib/private/mandarin-bridge/settings.json" && ln -sfn private/mandarin-bridge "$r/var/lib/mandarin-bridge" \
    && bridge_on_box "$r" update || { umount "$r"; losetup -d "$lo"; fail "Mandarin Bridge not installed on the test's disk"; }
  umount "$r"; losetup -d "$lo"
  ok "Mandarin Bridge $("$BRIDGES/installed/mandarin-bridge" --version | cut -d' ' -f2) installed with the service from before 0.3.12 (a DynamicUser's), its data folder as systemd 257 left it; $("$BRIDGES/next/mandarin-bridge" --version | cut -d' ' -f2) offered by a stand-in GitHub"
}

# What os/test/bridge-on-box.sh said on the box (its log in the shared folder, MandarinOS/Logs/BridgeTest_log.txt, kept
# on the data partition from one Mandarin OS to the next), once a line matches $1 (an extended regular expression),
# waiting up to $2 seconds; what the journal says of the Bridge's update after it.
bridge_said() {
  local i got=1
  for i in $(seq 1 $(($2 / 5))); do
    rm -f "$W/bridge-test.txt"; S -c "cd MandarinOS/Logs; get BridgeTest_log.txt $W/bridge-test.txt" >/dev/null
    grep -qE "$1" "$W/bridge-test.txt" 2>/dev/null && { got=0; break; }
    sleep 5
  done
  cat "$W/bridge-test.txt" 2>/dev/null
  curl -fsS --max-time 30 http://127.0.0.1:10080/api/logs/journal 2>/dev/null \
    | grep -aoE 'mandarin-bridge\[[0-9]+\]: .*update.*|migrating to .*mandarin-bridge.*|mandarin-bridge.service: .*' | tail -n 20 | sed 's/^/journal: /'
  return $got
}

bridge_update_check() {
  local said
  said="$(bridge_said 'bridge-test: (after|failed|no answer)' 600)"; printf '%s\n' "$said" | sed 's/^/  /'
  grep -q "bridge-test: data folder: owner mandarin-bridge:mandarin-bridge " <<< "$said" \
    || fail "Mandarin Bridge's data folder wasn't its own as it ran: $(grep 'data folder' <<< "$said")"
  grep -q "bridge-test: after: " <<< "$said" || fail "Mandarin Bridge didn't update itself on Mandarin OS"
  grep "bridge-test: after: " <<< "$said" | grep -q "\"name\":\"$BRIDGE_NAME\",\"version\":\"9.9.9\"" \
    || fail "Mandarin Bridge came back as something else: $(grep 'bridge-test: after' <<< "$said")"
  ok "Mandarin Bridge installed with the service from before: its data folder its own, it updated itself to 9.9.9 from there, and is still $BRIDGE_NAME"
}

bridge_after_os_update() {
  local said
  said="$(bridge_said 'bridge-test: (running|no answer)' 300)"; printf '%s\n' "$said" | sed 's/^/  /'
  grep "bridge-test: running: " <<< "$said" | tail -n 1 | grep -q "\"name\":\"$BRIDGE_NAME\",\"version\":\"9.9.9\"" \
    || fail "Mandarin Bridge after Mandarin OS updated in place: $(grep 'bridge-test' <<< "$said")"
  ok "after Mandarin OS updated in place, Mandarin Bridge still runs its update, 9.9.9, as $BRIDGE_NAME"
}
