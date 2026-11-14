# os/test/os-update-vm.sh — sourced by boot-test.sh: Mandarin OS updated in place (item 401), end to end, on the image
# being tested ($IMG, version $V), with its W, HERE, fail, ok, part and S.
#   os_update_prepare  after the install, before the first start: two newer Mandarin OS made from the image itself, as
#     [CHANGE]         os-image.yml publishes one (its system partition, compressed, and its kernel image, each with
#                      .sha256 and .sig), signed with a key made for this run and kept nowhere: 9.9.9 (as built, its
#                      version written in), and 9.9.10, broken (no os-release: the initrd won't start it, and a start
#                      that can't go on starts the computer again). A stand-in GitHub on this computer offers them
#                      (os/test/fake-os-release.js, as the test-os pre-release, 9.9.9 first), and the installed system's
#                      os-update is told to ask it and take that key by a drop-in written into the test's own copy of
#                      the installed disk (never the image), and into 9.9.9's system, for its own update to 9.9.10.
#                      CHANGE, where given, a function that changes 9.9.9's system further (given its mount point).
#   os_update_test     the box running: Update and restart asked of the system page with the share's password, and
#                      the box back as 9.9.9 (kept: its entry blessed), the share's password, the shared folder's user's
#                      number, the files in Storage and on USB drives, an ext4 drive's owners, Mandarin and its library
#                      as they were, the version before untouched on its own partition. Then 9.9.10: tried three times,
#                      and the box back on 9.9.9 by itself, the system page saying the update didn't start.
ROOT_T=4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709 ESP_T=C12A7328-F81F-11D2-BA4B-00A0C93EC93B

# Mandarin OS $1's release files in $W/osrel/$1, made from the image's system partition and kernel image; $2, where
# given, a function that changes the system further (given its mount point).
os_release() {
  local v="$1" change="${2:-}" d="$W/osrel/$1" rs rn es lo f
  mkdir -p "$d/uki" "$W/osm"
  read -r rs rn < <(sfdisk -J "$IMG" | jq -r --arg t "$ROOT_T" '.partitiontable.partitions[] | select(.type == $t) | "\(.start) \(.size)"')
  dd if="$IMG" of="$d/root.raw" bs=4M iflag=skip_bytes,count_bytes skip=$((rs * 512)) count=$((rn * 512)) status=none || fail "$v: the image's system not read"
  lo="$(losetup -f --show "$d/root.raw")" && mount "$lo" "$W/osm" || fail "$v: the image's system not mounted"
  echo "$v" > "$W/osm/usr/lib/mandarin-os/VERSION"
  sed -i "s/^IMAGE_VERSION=.*/IMAGE_VERSION=$v/" "$W/osm/usr/lib/os-release"
  mkdir -p "$W/osm/etc/systemd/system/mandarin-os-update@.service.d"
  cp "$W/os-update-test.conf" "$W/osm/etc/systemd/system/mandarin-os-update@.service.d/zz-update-test.conf"
  [ -z "$change" ] || "$change" "$W/osm"
  umount "$W/osm"; losetup -d "$lo"
  xz -T0 -1 -c "$d/root.raw" > "$d/mandarin-os-$v-x64.root.raw.xz" && rm -f "$d/root.raw" || fail "$v: not compressed"
  es="$(sfdisk -J "$IMG" | jq -r --arg t "$ESP_T" '.partitiontable.partitions[] | select(.type == $t) | .start')"
  mcopy -n -i "$IMG@@$((es * 512))" "::EFI/Linux/*.efi" "$d/uki/" && mv "$d"/uki/*.efi "$d/mandarin-os-$v-x64.efi" && rmdir "$d/uki" \
    || fail "$v: the image's kernel image not read"
  for f in "mandarin-os-$v-x64.root.raw.xz" "mandarin-os-$v-x64.efi"; do
    (cd "$d" && sha256sum "$f" > "$f.sha256") && openssl dgst -sha256 -sign "$W/os-key.pem" -out "$d/$f.sig" "$d/$f" || fail "$v: $f not signed"
  done
}
# 9.9.10's system, broken: no os-release, so the initrd refuses to start it (not an OS tree) and goes to its emergency
# mode, which starts the computer again (os/mkosi.conf).
os_broken() { rm -f "$1/usr/lib/os-release" "$1/etc/os-release"; }

os_update_prepare() {
  local lo rs rn
  openssl ecparam -name prime256v1 -genkey -noout -out "$W/os-key.pem" 2>/dev/null || fail "no key for the OS update"
  node "$HERE/fake-os-release.js" "$W/osrel" > "$W/osrel.log" 2>&1 & echo $! > "$W/osrel.pid"
  for i in $(seq 1 30); do [ -s "$W/osrel/port" ] && break; sleep 1; done
  [ -s "$W/osrel/port" ] || fail "the stand-in GitHub for Mandarin OS didn't start: $(cat "$W/osrel.log")"
  printf '[Service]\nEnvironment=MANDARIN_OS_UPDATE_API=http://10.0.2.2:%s/repos/meltface-80/Mandarin\nEnvironment=MANDARIN_OS_UPDATE_KEY=%s\n' \
    "$(cat "$W/osrel/port")" "$(openssl ec -in "$W/os-key.pem" -pubout -outform DER 2>/dev/null | base64 -w0)" > "$W/os-update-test.conf"
  os_release 9.9.9 "${1:-}"; os_release 9.9.10 os_broken
  ln -sfn 9.9.9 "$W/osrel/current"
  ls -la "$W"/osrel/9.9.9 | sed 's/^/  /'
  read -r rs rn < <(part "$W/disk.raw" "mandarin-os_$V")
  lo="$(losetup -f --show -o $((rs * 512)) --sizelimit $((rn * 512)) "$W/disk.raw")" || fail "no loop device for the installed system"
  mkdir -p "$W/root" && mount "$lo" "$W/root" || { losetup -d "$lo"; fail "the installed system's partition didn't mount"; }
  mkdir -p "$W/root/etc/systemd/system/mandarin-os-update@.service.d"
  cp "$W/os-update-test.conf" "$W/root/etc/systemd/system/mandarin-os-update@.service.d/zz-update-test.conf"
  umount "$W/root"; losetup -d "$lo"
  ok "Mandarin OS 9.9.9 and a broken 9.9.10 made from the image, signed with the test's key, offered by a stand-in GitHub"
}

# What the box's own log says of its updates (and its system page's), to find why.
os_why() {
  S -c "cd MandarinOS/Logs; get MandarinOS_log.txt $W/os.log" >/dev/null; grep -a "\[update\]\|\[system page\]" "$W/os.log" 2>/dev/null | tail -n 30
  tail -n 5 "$W/osrel.log"
}
OSU() { curl -sS --max-time 200 -H 'Content-Type: application/json' -d "{\"password\":\"listen-carefully\",\"action\":\"$1\"}" http://127.0.0.1:10080/api/os-update; }
# The system page's state once $1 (a jq test of it) holds, waiting up to $2 seconds through the restarts; said as it goes.
os_until() {
  local i st="" was=""
  for i in $(seq 1 $(($2 / 10))); do
    st="$(curl -fsS --max-time 10 http://127.0.0.1:10080/api/state 2>/dev/null)" && jq -e "$1" <<< "$st" >/dev/null 2>&1 && { printf '%s' "$st"; return 0; }
    now="$(jq -r '"\(.os.version) \(.os.update.state) \(.os.update.said)"' <<< "$st" 2>/dev/null || echo "not answering")"
    [ "$now" = "$was" ] || echo "  $(date -u +%H:%M:%S) $now" >&2; was="$now"
    sleep 10
  done
  return 1
}
# The EFI partition's entries, as the host reads the test's disk.
os_entries() { mdir -b -i "$W/disk.raw@@$(( $(part "$W/disk.raw" esp | cut -d' ' -f1) * 512 ))" ::loader/entries 2>&1 | sed 's|.*/||' | sort | tr '\n' ' '; }

os_update_test() {
  local st uid m albums r i e parts lo rs rn
  st="$(curl -fsS --max-time 30 http://127.0.0.1:10080/api/state)" || fail "the system page's state"
  [ "$(jq -r .os.update.version <<< "$st")" = "$V" ] || fail "the system page's Mandarin OS: $(jq -c .os.update <<< "$st")"
  uid="$(jq -r .share.uid <<< "$st")"; [[ "$uid" =~ ^[0-9]+$ ]] || fail "the shared folder's user's number: $(jq -c .share <<< "$st")"
  h="$(curl -fsS --max-time 10 http://127.0.0.1:13500/api/health)"; m="$(jq -r .version <<< "$h")"; albums="$(jq -r .albums <<< "$h")"
  S -c "cd Storage; get song.flac $W/song.before" >/dev/null; S -c "cd \"Storage/USB/Music SSD/Artist/Album\"; get 01.flac $W/usb.before" >/dev/null
  [ -s "$W/song.before" ] && [ -s "$W/usb.before" ] || fail "the files to compare after the update weren't read"

  r="$(OSU check)"; [ "$(jq -r .update.available <<< "$r")" = 9.9.9 ] || { os_why; fail "Check for updates didn't find 9.9.9: $r"; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"password":"not-it","action":"apply"}' http://127.0.0.1:10080/api/os-update)" = 401 ] \
    || fail "the update was taken with a wrong password"
  r="$(OSU apply)"; jq -e .ok <<< "$r" >/dev/null || { os_why; fail "Update and restart wasn't taken: $r"; }
  ok "Check for updates found Mandarin OS 9.9.9; Update and restart taken with the share's password (and not without it)"
  st="$(os_until '.os.version == "9.9.9" and .os.update.last.result == "updated"' 1500)" || { os_why; fail "the box didn't come back as Mandarin OS 9.9.9"; }
  ok "the box came back as Mandarin OS 9.9.9: $(jq -c .os.update.last <<< "$st")"
  for i in $(seq 1 24); do e="$(os_entries)"; [[ "$e" == *"mandarin-os_9.9.9.conf "* ]] && break; sleep 5; done
  [[ "$e" == *"mandarin-os_9.9.9.conf "* ]] && [[ "$e" == *"mandarin-os_$V.conf "* ]] || fail "9.9.9 wasn't kept (systemd-bless-boot), or $V's entry went: $e"
  ok "9.9.9 kept (its entry blessed), $V's entry still there to go back to: $e"

  # Nothing of the box's lost.
  [ "$(jq -r .share.uid <<< "$st")" = "$uid" ] || fail "the shared folder's user's number moved: $uid, now $(jq -r .share.uid <<< "$st")"
  r="$(S -c ls)"; grep -q README.txt <<< "$r" || fail "the share's password no longer takes: $r"
  rm -f "$W/song.after" "$W/usb.after"
  S -c "cd Storage; get song.flac $W/song.after" >/dev/null; cmp -s "$W/song.before" "$W/song.after" || fail "Storage's file changed"
  for i in $(seq 1 24); do S -c "cd \"Storage/USB/Music SSD/Artist/Album\"; get 01.flac $W/usb.after" >/dev/null; [ -s "$W/usb.after" ] && break; sleep 5; done
  cmp -s "$W/usb.before" "$W/usb.after" || fail "the USB drive's file changed, or the drive isn't mounted"
  r="$(ren 01.flac 02.flac)"; ! grep -q NT_STATUS <<< "$r" || fail "the ext4 drive made the shared folder's isn't any more: $r"
  ren 02.flac 01.flac >/dev/null
  h="$(curl -fsS --max-time 10 http://127.0.0.1:13500/api/health)" || fail "Mandarin doesn't answer on 9.9.9"
  [ "$(jq -r .version <<< "$h")" = "$m" ] && [ "$(jq -r .albums <<< "$h")" = "$albums" ] || fail "Mandarin was $m with $albums albums, now: $h"
  ok "the share's password, its user's number ($uid), Storage's and the USB drive's files, an ext4 drive's owners, Mandarin $m and its $albums albums: as they were"
  parts="$(sfdisk -J "$W/disk.raw" | jq -r '[.partitiontable.partitions[].name] | join(",")')"
  [ "$parts" = "esp,mandarin-os_$V,mandarin-os_9.9.9,mandarin-data" ] || fail "the disk's partitions: $parts"
  read -r rs rn < <(part "$W/disk.raw" "mandarin-os_$V")
  lo="$(losetup -r -f --show -o $((rs * 512)) --sizelimit $((rn * 512)) "$W/disk.raw")" && mkdir -p "$W/old" && mount -o ro,noload "$lo" "$W/old" \
    || { [ -n "${lo:-}" ] && losetup -d "$lo"; fail "the version before's partition didn't mount"; }
  r="$(cat "$W/old/usr/lib/mandarin-os/VERSION")"; umount "$W/old"; losetup -d "$lo"
  [ "$r" = "$V" ] || fail "the version before's partition holds $r"
  ok "Mandarin OS $V untouched on its own partition: $parts"

  # A version that doesn't start: tried three times, then the one that worked, by itself.
  ln -sfn 9.9.10 "$W/osrel/current"
  r="$(OSU check)"; [ "$(jq -r .update.available <<< "$r")" = 9.9.10 ] || { os_why; fail "Check for updates didn't find 9.9.10: $r"; }
  r="$(OSU apply)"; jq -e .ok <<< "$r" >/dev/null || { os_why; fail "Update and restart (9.9.10) wasn't taken: $r"; }
  st="$(os_until '.os.version == "9.9.9" and .os.update.last.result == "failed" and .os.update.last.to == "9.9.10"' 1500)" \
    || { os_why; fail "the box didn't come back on 9.9.9 by itself after 9.9.10"; }
  ok "9.9.10 didn't start: the box is back on 9.9.9 by itself, and its page says so: $(jq -c .os.update.last <<< "$st")"
  # Taken off at the start that came back (os-started boot): never started again, its kernel image's room given back.
  for i in $(seq 1 24); do e="$(os_entries)"; [[ "$e" != *"9.9.10"* ]] && break; sleep 5; done
  [[ "$e" != *"9.9.10"* ]] && [[ "$e" == *"mandarin-os_9.9.9.conf "* ]] || { os_why; fail "the EFI partition's entries after the fallback: $e"; }
  h="$(curl -fsS --max-time 10 http://127.0.0.1:13500/api/health)" && [ "$(jq -r .version <<< "$h")" = "$m" ] || fail "Mandarin after the fallback: ${h:-not answering}"
  r="$(S -c ls)"; grep -q README.txt <<< "$r" || fail "the share after the fallback: $r"
  ok "9.9.10's entry taken off ($e), Mandarin and the share as before"
}
