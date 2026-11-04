#!/bin/bash
# Mandarin Bridge's Raspberry Pi image (item 283): Raspberry Pi OS Lite (64-bit) with the Bridge and the audio engine
# it plays with, ffmpeg, and the Bridge started at boot with its Wi-Fi setup on. Flash it (Raspberry Pi Imager: "Use
# custom"), plug in the DAC, power on: on the network the Imager set, or, with none, its own "Mandarin Bridge Setup"
# Wi-Fi (password mandarin-setup), its page at http://10.42.0.1:49494/ to choose the home network. The Pi calls itself
# mandarin-bridge (http://mandarin-bridge.local:49494/).
#
#   sudo bridge/pi/build-image.sh mandarin-bridge-pi-arm64.img   (on a 64-bit ARM Linux, after
#                                                                 RID=linux-arm64 engine/build.sh and bridge/linux/build.sh)
set -euo pipefail
OUT=${1:-mandarin-bridge-pi-arm64.img}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
URL=${PI_OS_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64_latest}
COUNTRY=${WIFI_COUNTRY:-GB}
[ "$(id -u)" = 0 ] || { echo "run it as root" >&2; exit 1; }
[ "$(uname -m)" = aarch64 ] || { echo "build it on 64-bit ARM: the Pi's own programs run in it to install ffmpeg" >&2; exit 1; }
for f in "$REPO/bridge/linux/bin/mandarin-bridge" "$REPO/engine/bin/mandarin-audio"; do [ -x "$f" ] || { echo "$f isn't built" >&2; exit 1; }; done

WORK=$(mktemp -d)
LOOP=""
cleanup() {
  set +e
  for m in "$WORK/root/dev/pts" "$WORK/root/dev" "$WORK/root/proc" "$WORK/root/sys" "$WORK/root/boot/firmware" "$WORK/root"; do mountpoint -q "$m" && umount "$m"; done
  [ -n "$LOOP" ] && losetup -d "$LOOP"
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Raspberry Pi OS Lite from $URL"
curl -fL --retry 3 -o "$WORK/os.img.xz" "$URL"
xz -dc "$WORK/os.img.xz" > "$OUT"
# Room for ffmpeg: the root partition grown by a gigabyte (the Pi grows it to the card's size on its first start).
truncate -s +1G "$OUT"
parted -s "$OUT" resizepart 2 100%
LOOP=$(losetup -Pf --show "$OUT")
e2fsck -pf "${LOOP}p2" || true
resize2fs "${LOOP}p2"
R="$WORK/root"
mkdir -p "$R"
mount "${LOOP}p2" "$R"
mount "${LOOP}p1" "$R/boot/firmware"
for d in dev dev/pts proc sys; do mount --bind "/$d" "$R/$d"; done
cp "$R/etc/resolv.conf" "$WORK/resolv.conf" 2>/dev/null || true
cp --remove-destination /etc/resolv.conf "$R/etc/resolv.conf"

echo "ffmpeg"
chroot "$R" apt-get update -q
chroot "$R" env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends ffmpeg
chroot "$R" apt-get clean

echo "Mandarin Bridge"
install -d "$R/usr/lib/mandarin-bridge" "$R/etc/systemd/system/mandarin-bridge.service.d"
install -m 755 "$REPO/bridge/linux/bin/mandarin-bridge" "$REPO/engine/bin/mandarin-audio" "$R/usr/lib/mandarin-bridge/"
install -m 644 "$REPO/bridge/linux/mandarin-bridge.service" "$R/etc/systemd/system/mandarin-bridge.service"
install -m 644 "$HERE/pi.conf" "$R/etc/systemd/system/mandarin-bridge.service.d/pi.conf"
chroot "$R" systemctl enable mandarin-bridge
# Its name on the network, and Wi-Fi allowed to start (Raspberry Pi OS keeps it off until a country is set).
echo mandarin-bridge > "$R/etc/hostname"
sed -i 's/^127\.0\.1\.1.*/127.0.1.1\tmandarin-bridge/' "$R/etc/hosts"
grep -q ieee80211_regdom "$R/boot/firmware/cmdline.txt" || sed -i "1 s/\$/ cfg80211.ieee80211_regdom=$COUNTRY/" "$R/boot/firmware/cmdline.txt"
rm -f "$R"/var/lib/systemd/rfkill/*wlan

# It runs where it is put.
chroot "$R" /usr/lib/mandarin-bridge/mandarin-bridge --version
chroot "$R" ffmpeg -hide_banner -version | head -1

if [ -f "$WORK/resolv.conf" ]; then cp --remove-destination "$WORK/resolv.conf" "$R/etc/resolv.conf"; fi
sync
echo "$OUT made"
