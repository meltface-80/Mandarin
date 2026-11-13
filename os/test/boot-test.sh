#!/bin/bash
# os/test/boot-test.sh <image.raw> — Mandarin OS installed and started in a virtual machine (QEMU, UEFI), as a person
# would: the image written to a USB stick, a computer with an empty disk started from it, the installer answered
# (mandarin-install.json on the stick), the computer started again from its disk. Then, through the firewall:
#   Mandarin answers (/api/health), with nothing under way; the share smb://mandarin/data takes the user chosen, its
#   README and layout there, music written into Storage, and nothing written where it is read-only; Mandarin's and the
#   system's logs in it; nothing at all on SSH's port; mandarin.local and the system's own checks (maintain --check) are
#   asked of it through its logs; USB drives (exFAT, NTFS, ext4) plugged in at the start and while it runs, each
#   mounted in Storage/USB with its music and on the system page; one whose files are another's made the shared
#   folder's from the system page (item 399). Then, given NEXT (os/test/next-mandarin.sh's program,
#   a newer Mandarin), the in-app update (item 398): Settings → Updates on the installed system takes a newer release from
#   a stand-in GitHub on this computer, and Mandarin starts again as it, its library and account kept. Needs
#   qemu-system-x86_64, OVMF, mtools, smbclient, curl, jq, exfatprogs, ntfs-3g, node, python3, and root (loop devices,
#   for the USB drives' filesystems and the installed disk's).
#     os/test/boot-test.sh <image.raw> [NEXT]
set -uo pipefail
IMG="${1:?the image}" NEXT="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
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

# A partition of disk image $1 by its label $2: its start and size, in sectors.
part() { sfdisk -J "$1" | jq -r --arg n "$2" '.partitiontable.partitions[] | select(.name == $n) | "\(.start) \(.size)"'; }

# The stick, answered. Its version, as its system partition is labelled (mandarin-os_<version>, item 401).
cp --sparse=always "$IMG" "$W/usb.raw"
V="$(sfdisk -J "$W/usb.raw" | jq -r '.partitiontable.partitions[] | select(.type == "4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709") | .name')"
V="${V#mandarin-os_}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "the stick's system partition isn't labelled with its version: $V"
esp_start="$(sfdisk -J "$W/usb.raw" | jq '.partitiontable.partitions[] | select(.type == "C12A7328-F81F-11D2-BA4B-00A0C93EC93B") | .start')"
printf '{"disk":"first","share_user":"music","share_password":"listen-carefully","network":{"mode":"dhcp"},"bridge":false,"erase":"erase"}\n' > "$W/answers.json"
mcopy -i "$W/usb.raw@@$((esp_start * 512))" "$W/answers.json" ::mandarin-install.json || fail "answers not put on the stick"
truncate -s 16G "$W/disk.raw"

echo "Installing from the stick ($ACCEL)…"
QT=1800 qemu install -device qemu-xhci -drive if=none,id=stick,format=raw,file="$W/usb.raw" -device usb-storage,drive=stick,removable=on \
  -drive if=virtio,format=raw,file="$W/disk.raw" -nic user,model=virtio-net-pci || fail "the installer didn't finish (or the machine didn't stop)"
parts="$(sfdisk -J "$W/disk.raw" | jq -r '[.partitiontable.partitions[].name] | join(",")')"
# Its system partition labelled with its version, the other kept empty for the next (item 401).
[ "$parts" = "esp,mandarin-os_$V,_empty,mandarin-data" ] || fail "the disk's partitions: $parts"
ok "installed: $parts"
# It starts from an entry of its own naming its own partition (boot.sh), the stick's way (EFI/Linux) taken off.
esp_at="$(part "$W/disk.raw" esp | cut -d' ' -f1)"
ents="$(mdir -b -i "$W/disk.raw@@$((esp_at * 512))" ::loader/entries 2>&1)"; linux="$(mdir -b -i "$W/disk.raw@@$((esp_at * 512))" ::EFI/Linux 2>&1)"
grep -q "mandarin-os_$V.conf" <<< "$ents" && ! grep -q '\.efi' <<< "$linux" || fail "the EFI partition's entries: $ents; EFI/Linux: $linux"
ok "it starts from its own entry: $(basename "$(grep conf <<< "$ents")")"
# The stick starts quietly, straight to the installer: nothing waited for, nothing failed (a screen of them was taken
# for an error on the first real computer).
grep -aE "Timed out waiting|Dependency failed|Failed to start" "$W/serial-install.log" && fail "the stick's start said something failed"
ok "the stick started without a failure on its screen"

# The in-app update's stand-in GitHub (os/test/fake-release.js): a release of NEXT, signed with a key made for this run,
# on this computer, which the virtual machine reaches as 10.0.2.2. The installed Mandarin is told to ask it, and to
# take that key, by a drop-in for its service written into the test's own copy of the installed disk ($W/disk.raw),
# after the install and before its first start: never into the image, which is published as it was built.
if [ -n "$NEXT" ]; then
  node "$HERE/fake-release.js" "$NEXT" "$W/release" > "$W/release.log" 2>&1 & echo $! > "$W/release.pid"
  for i in $(seq 1 60); do [ -s "$W/release/port" ] && break; sleep 1; done
  [ -s "$W/release/port" ] || fail "the stand-in GitHub didn't start: $(cat "$W/release.log")"
  read -r rs rn < <(part "$W/disk.raw" "mandarin-os_$V")
  lo="$(losetup -f --show -o $((rs * 512)) --sizelimit $((rn * 512)) "$W/disk.raw")" || fail "no loop device for the installed system"
  mkdir -p "$W/root" && mount "$lo" "$W/root" || { losetup -d "$lo"; fail "the installed system's partition didn't mount"; }
  printf '[Service]\nEnvironment=UPDATE_API=http://10.0.2.2:%s\nEnvironment=UPDATE_KEY=%s\n' "$(cat "$W/release/port")" "$(cat "$W/release/update.pub")" \
    > "$W/root/etc/systemd/system/mandarin.service.d/zz-update-test.conf"
  umount "$W/root"; losetup -d "$lo"
  ok "the installed Mandarin asks the stand-in GitHub for $("$NEXT" --version), signed with the test's key"
fi

# USB drives as music comes on them: a GPT partition table and one partition (exFAT, NTFS or ext4), or ext4 on the
# whole disk with no partitions (as a Linux machine, DietPi, often formats one); a track on each.
usb_disk() {  # file, filesystem, label, "whole" for no partition table
  local f="$1" lo part; truncate -s 300M "$f"
  if [ "${4:-}" = whole ]; then lo="$(losetup -f --show "$f")" && part="$lo"
  else
    printf 'label: gpt\nstart=2048, type=EBD0A0A2-B9E5-4433-87C0-68B6B72699C7\n' | sfdisk -q "$f" || fail "no partition on $f"
    # The partition by its offset and size (1 MiB in, to the partition table's copy at the end): no partition device
    # to wait for (/dev/loopNp1 needs udev).
    lo="$(losetup -f --show -o 1048576 --sizelimit "$(( $(sfdisk -J "$f" | jq '.partitiontable.partitions[0].size') * 512 ))" "$f")" && part="$lo"
  fi
  [ -n "${lo:-}" ] || fail "no loop device for $f"
  case "$2" in
    exfat) mkfs.exfat -q -L "$3" "$part" ;; ntfs) mkfs.ntfs -q -f -L "$3" "$part" ;; ext4) mkfs.ext4 -q -L "$3" "$part" ;;
  esac >/dev/null || { losetup -d "$lo"; fail "no $2 on $f"; }
  mkdir -p "$W/m" && mount "$part" "$W/m" && mkdir -p "$W/m/Artist/Album" && head -c 65536 /dev/urandom > "$W/m/Artist/Album/01.flac" && umount "$W/m"
  losetup -d "$lo"
}
usb_disk "$W/usb-exfat.raw" exfat "Music SSD"; usb_disk "$W/usb-ntfs.raw" ntfs "Music NTFS"; usb_disk "$W/usb-ext4.raw" ext4 "Music ext4" whole
usb_disk "$W/usb-later.raw" ext4 "Plugged Later"
usb() { printf -- '-drive if=none,id=%s,format=raw,file=%s -device usb-storage,bus=xhci.0,drive=%s' "$1" "$2" "$1"; }

echo "Starting from the disk, three USB drives plugged in…"
# shellcheck disable=SC2046
qemu disk -drive if=virtio,format=raw,file="$W/disk.raw" -device qemu-xhci,id=xhci \
  $(usb u1 "$W/usb-exfat.raw") $(usb u2 "$W/usb-ntfs.raw") $(usb u3 "$W/usb-ext4.raw") -monitor unix:"$W/monitor.sock",server,nowait \
  -nic user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:13500-:3500,hostfwd=tcp:127.0.0.1:10445-:445,hostfwd=tcp:127.0.0.1:10022-:22,hostfwd=tcp:127.0.0.1:10080-:80 &
for i in $(seq 1 180); do h="$(curl -fsS --max-time 5 http://127.0.0.1:13500/api/health 2>/dev/null)" && break; sleep 5; done
[ -n "${h:-}" ] || fail "Mandarin didn't answer in 15 minutes"
[ "$(jq -r .ok <<< "$h")" = true ] || fail "Mandarin's health: $h"
ok "Mandarin $(jq -r .version <<< "$h") answers through the firewall"
grep -aE "Timed out waiting|Dependency failed|Failed to start" "$W/serial-disk.log" && fail "the installed system's start said something failed"
ok "the installed system started without a failure on its screen"

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
# Let in is the share's contents coming back; refused is anything else (what Samba said, shown either way).
wrong="$(smbclient //127.0.0.1/Data -p 10445 -U 'music%wrong-password' -m SMB3 -c ls 2>&1)"
grep -q README.txt <<< "$wrong" && fail "a wrong password was let in: $wrong"
echo "  a wrong password: $(grep -o 'NT_STATUS_[A-Z_]*' <<< "$wrong" | head -n 1)"
guest="$(smbclient //127.0.0.1/Data -p 10445 -N -m SMB3 -c ls 2>&1)"
grep -q README.txt <<< "$guest" && fail "a guest was let in: $guest"
echo "  a guest: $(grep -o 'NT_STATUS_[A-Z_]*' <<< "$guest" | head -n 1)"
ok "no guest, no wrong password"
if curl -s --max-time 5 telnet://127.0.0.1:10022 </dev/null | grep -q SSH; then fail "something answers on SSH's port"; fi
ok "nothing on SSH's port"

# The system page, http://mandarin/: its state read without a password, a change only with the share's.
for i in $(seq 1 12); do page="$(curl -fsS --max-time 10 http://127.0.0.1:10080/ 2>&1)" && break; sleep 5; done
if ! grep -q "<title>Mandarin OS</title>" <<< "$page"; then
  S -c "cd MandarinOS/Logs; get SystemPage_errors.txt $W/page-errors.txt" >/dev/null; cat "$W/page-errors.txt" 2>/dev/null
  S -c "cd MandarinOS/Logs; get MandarinOS_log.txt $W/os.log" >/dev/null; tail -n 30 "$W/os.log" 2>/dev/null
  fail "the system page doesn't answer on port 80: ${page:0:300}"
fi
st="$(curl -fsS --max-time 30 http://127.0.0.1:10080/api/state)" || fail "the system page's state doesn't answer"
[ "$(jq -r .mandarin.answering <<< "$st")" = true ] || fail "the system page doesn't see Mandarin: $st"
for u in mandarin.service smbd.service; do
  [ "$(jq -r --arg u "$u" '.services[] | select(.unit == $u) | .state' <<< "$st")" = active ] || fail "the system page says $u isn't running: $st"
done
P() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Content-Type: application/json' -d "$1" http://127.0.0.1:10080/api/check; }
[ "$(P '{"password":"not-it"}')" = 401 ] || fail "the system page took a wrong password"
[ "$(P '{"password":"listen-carefully"}')" = 200 ] || fail "the system page didn't take the share's password"
ok "the system page answers, sees Mandarin and its services, and asks for the share's password"

# USB drives: those plugged in at the start, and one plugged in later, each mounted in Storage/USB with its music, and
# on the system page. Not: the log of what happened to each, to find why.
usb_why() {
  curl -fsS --max-time 30 http://127.0.0.1:10080/api/logs/journal 2>/dev/null | grep -iE "usb|sd[a-z]|mandarin-usb|exfat|ntfs|ext4" | tail -n 40
  S -c "cd MandarinOS/Logs; get MandarinOS_log.txt $W/os.log" >/dev/null; grep -a "\[usb\]" "$W/os.log" 2>/dev/null | tail -n 20
}
usb_in() {  # name: its music in the share, and the system page knows it
  local i; for i in $(seq 1 24); do S -c "cd \"Storage/USB/$1/Artist/Album\"; ls" | grep -q "01.flac" && break; sleep 5; done
  S -c "cd \"Storage/USB/$1/Artist/Album\"; ls" | grep -q "01.flac" || { usb_why; fail "the USB drive $1 isn't in Storage/USB: $(S -c 'cd Storage/USB; ls')"; }
  curl -fsS --max-time 30 http://127.0.0.1:10080/api/state | jq -e --arg n "$1" '.usb[] | select(.name == $n and (.read_only | not))' >/dev/null \
    || { usb_why; fail "the system page doesn't show $1, writable: $(curl -fsS http://127.0.0.1:10080/api/state | jq -c .usb)"; }
}
for d in "Music SSD" "Music NTFS" "Music ext4"; do usb_in "$d"; done
ok "three USB drives plugged in at the start (exFAT, NTFS, ext4 on the whole disk): each in Storage/USB with its music, writable, on the system page"
# A Linux drive written on another computer (item 399): "Music ext4"'s files are root's, as this test wrote them, so the
# shared folder can't rename in it until the system page makes them the shared folder's; then it can.
ren() { S -c "cd \"Storage/USB/Music ext4/Artist/Album\"; rename $1 $2"; }
curl -fsS --max-time 30 http://127.0.0.1:10080/api/state | jq -e '.usb[] | select(.name == "Music ext4" and .others)' >/dev/null \
  || fail "the system page doesn't say Music ext4's files are another's: $(curl -fsS http://127.0.0.1:10080/api/state | jq -c .usb)"
# (Its answer kept first: smbclient fails the rename, and with pipefail a pipe into grep would fail with it.)
r="$(ren 01.flac 02.flac)"; grep -q NT_STATUS_ACCESS_DENIED <<< "$r" || fail "a rename on another's drive wasn't refused: $r"
own="$(curl -sS --max-time 30 -H 'Content-Type: application/json' -d '{"password":"listen-carefully","name":"Music ext4"}' http://127.0.0.1:10080/api/usb/own)"
jq -e .ok <<< "$own" >/dev/null || fail "the system page didn't take Make them the shared folder's: $own"
for i in $(seq 1 60); do u="$(curl -fsS --max-time 30 http://127.0.0.1:10080/api/state | jq -c '.usb[] | select(.name == "Music ext4")')"; [ "$(jq -r '.changing' <<< "$u")" = "" ] && break; sleep 2; done
[ "$(jq -r '"\(.changing)|\(.others)"' <<< "$u")" = "|false" ] || { usb_why; fail "Music ext4's files weren't made the shared folder's: $u"; }
r="$(ren 01.flac 02.flac)"; ! grep -q NT_STATUS <<< "$r" || fail "a rename on the drive made the shared folder's: $r"
ren 02.flac 01.flac >/dev/null
ok "a Linux drive whose files are another's: said so, renaming refused, then made the shared folder's from the system page, and renaming works"
printf 'drive_add 0 if=none,id=u4,format=raw,file=%s\ndevice_add usb-storage,bus=xhci.0,drive=u4,id=later\n' "$W/usb-later.raw" \
  | python3 -c 'import socket,sys,time; s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); time.sleep(0.5); [ (s.sendall(l.encode()), time.sleep(1)) for l in sys.stdin ]; time.sleep(1)' "$W/monitor.sock" \
  || fail "QEMU's monitor didn't take the drive"
usb_in "Plugged Later"
ok "a USB drive plugged in while it runs (ext4, partitioned): mounted in Storage/USB with its music, on the system page"

# The in-app update (item 398): once installed, Mandarin gets newer by Settings → Updates alone. A track in Storage, then
# os/test/in-app-update.js: signed in and scanned, Check for updates and Update as the page asks them, and Mandarin back
# as NEXT, started again in its own process, its library, account and sign-in kept, nothing failed in the journal.
if [ -n "$NEXT" ]; then
  python3 -c 'import wave,sys; w=wave.open(sys.argv[1],"wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100); w.writeframes(bytes(176400)); w.close()' "$W/kept.wav"
  S -c 'cd Storage; mkdir "Update Test"; cd "Update Test"; mkdir "Before the Update"' >/dev/null
  S -c "cd \"Storage/Update Test/Before the Update\"; put $W/kept.wav \"01 Kept.wav\"" >/dev/null
  node "$HERE/in-app-update.js" http://127.0.0.1:13500 http://127.0.0.1:10080 "$W/release.log" "Before the Update" \
    || { cat "$W/release.log"; fail "the in-app update"; }
  ok "updated in the app to $("$NEXT" --version): downloaded, checked, started again, nothing lost"
else
  echo "not tested: the in-app update (no NEXT given: os/test/next-mandarin.sh builds one)"
fi
echo "PASS"
