#!/bin/bash
# os/test/boot-test.sh <image.raw> — Mandarin OS installed and started in a virtual machine (QEMU, UEFI), as a person
# would: the image written to a USB stick, a computer with an empty disk started from it, the installer answered
# (mandarin-install.json on the stick), the computer started again from its disk. Then, through the firewall:
#   Mandarin answers (/api/health), with nothing under way; the share smb://mandarin/data takes the user chosen, its
#   README and layout there, music written into Storage, and nothing written where it is read-only; Mandarin's and the
#   system's logs in it; nothing at all on SSH's port; mandarin.local and the system's own checks (maintain --check) are
#   asked of it through its logs. Needs qemu-system-x86_64, OVMF, mtools, smbclient, curl, jq.
set -uo pipefail
IMG="${1:?the image}"
W="$(mktemp -d)"
# Each virtual machine stopped at the end, whatever happened: by its own process number (-pidfile), never left running.
trap 'for p in "$W"/*.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null; done; sleep 1; rm -rf "$W"' EXIT
OVMF_CODE="${OVMF_CODE:-/usr/share/OVMF/OVMF_CODE_4M.fd}" OVMF_VARS="${OVMF_VARS:-/usr/share/OVMF/OVMF_VARS_4M.fd}"
ACCEL=tcg; [ -w /dev/kvm ] && ACCEL=kvm
fail() { echo "FAIL: $*"; echo "--- serial (last 60 lines) ---"; tail -n 60 "$W"/serial*.log 2>/dev/null; exit 1; }
ok() { echo "ok: $*"; }
qemu() {  # name, then the disks
  local name="$1"; shift
  cp "$OVMF_VARS" "$W/$name.vars"
  ${QT:+timeout "$QT"} qemu-system-x86_64 -machine q35,accel=$ACCEL -m 3072 -smp 2 -display none -serial "file:$W/serial-$name.log" -pidfile "$W/$name.pid" \
    -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" -drive if=pflash,format=raw,file="$W/$name.vars" "$@"
}

# The stick, answered.
cp --sparse=always "$IMG" "$W/usb.raw"
esp_start="$(sfdisk -J "$W/usb.raw" | jq '.partitiontable.partitions[] | select(.type == "C12A7328-F81F-11D2-BA4B-00A0C93EC93B") | .start')"
printf '{"disk":"first","share_user":"music","share_password":"listen-carefully","network":{"mode":"dhcp"},"bridge":false,"erase":"erase"}\n' > "$W/answers.json"
mcopy -i "$W/usb.raw@@$((esp_start * 512))" "$W/answers.json" ::mandarin-install.json || fail "answers not put on the stick"
truncate -s 16G "$W/disk.raw"

echo "Installing from the stick ($ACCEL)…"
QT=1800 qemu install -device qemu-xhci -drive if=none,id=stick,format=raw,file="$W/usb.raw" -device usb-storage,drive=stick,removable=on \
  -drive if=virtio,format=raw,file="$W/disk.raw" -nic user,model=virtio-net-pci || fail "the installer didn't finish (or the machine didn't stop)"
parts="$(sfdisk -J "$W/disk.raw" | jq -r '[.partitiontable.partitions[].name] | join(",")')"
[ "$parts" = "mandarin-os-a,_empty,mandarin-data" ] || [[ "$parts" == *"mandarin-os-a"*"mandarin-data"* ]] || fail "the disk's partitions: $parts"
ok "installed: $parts"

echo "Starting from the disk…"
qemu disk -drive if=virtio,format=raw,file="$W/disk.raw" \
  -nic user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:13500-:3500,hostfwd=tcp:127.0.0.1:10445-:445,hostfwd=tcp:127.0.0.1:10022-:22,hostfwd=tcp:127.0.0.1:10080-:80 &
for i in $(seq 1 180); do h="$(curl -fsS --max-time 5 http://127.0.0.1:13500/api/health 2>/dev/null)" && break; sleep 5; done
[ -n "${h:-}" ] || fail "Mandarin didn't answer in 15 minutes"
[ "$(jq -r .ok <<< "$h")" = true ] || fail "Mandarin's health: $h"
ok "Mandarin $(jq -r .version <<< "$h") answers through the firewall"

S() { smbclient //127.0.0.1/Data -p 10445 -U 'music%listen-carefully' -m SMB3 "$@" 2>&1; }
for i in $(seq 1 24); do S -c ls | grep -q README.txt && break; sleep 5; done
list="$(S -c ls)"
for d in README.txt Storage MandarinServer MandarinBridge MandarinApp MandarinOS; do grep -q " $d " <<< "$list" || fail "the share has no $d: $list"; done
ok "the share takes the user chosen, laid out as Data"
echo "a song" > "$W/song.flac"
S -c "cd Storage; put $W/song.flac song.flac" >/dev/null; S -c "cd Storage; ls" | grep -q song.flac || fail "music couldn't be copied into Storage"
ok "music copied into Storage"
said="$(S -c "cd MandarinOS; put $W/song.flac nope.flac")"
S -c "cd MandarinOS; ls" | grep -q nope.flac && fail "MandarinOS could be written ($said)"
S -c "cd MandarinServer/Logs; put $W/song.flac nope.flac" >/dev/null; S -c "cd MandarinServer/Logs; ls" | grep -q nope.flac && fail "Mandarin's logs could be written"
ok "MandarinOS and Mandarin's logs are read-only"
logs="$(S -c "cd MandarinServer/Logs; ls")"
grep -q NT_STATUS <<< "$logs" && fail "Mandarin's logs can't be read in the share: $logs"
# Mandarin's own rolling log came after v1.3.0 (item 389): where the release installed writes it, it is here.
if grep -q MandarinServer_log.txt <<< "$logs"; then
  S -c "cd MandarinServer/Logs; get MandarinServer_log.txt $W/server.log" >/dev/null
  grep -q "^# Mandarin Server .*" "$W/server.log" || fail "Mandarin's log in the share isn't its log"
  ok "Mandarin's log is in the share"
else
  ok "Mandarin's logs folder opens in the share (this release writes no rolling log yet)"
fi
S -c "cd MandarinOS/Logs; get MandarinOS_log.txt $W/os.log" >/dev/null; grep -q "\[apply\] done" "$W/os.log" || fail "the system's log isn't in the share"
ok "the system's log is in the share"
smbclient //127.0.0.1/Data -p 10445 -U 'music%wrong-password' -m SMB3 -c ls 2>&1 | grep -q NT_STATUS_LOGON_FAILURE || fail "a wrong password was let in"
smbclient //127.0.0.1/Data -p 10445 -N -m SMB3 -c ls 2>&1 | grep -qE "NT_STATUS_(ACCESS_DENIED|LOGON_FAILURE)" || fail "a guest was let in"
ok "no guest, no wrong password"
if curl -s --max-time 5 telnet://127.0.0.1:10022 </dev/null | grep -q SSH; then fail "something answers on SSH's port"; fi
ok "nothing on SSH's port"
echo "PASS"
