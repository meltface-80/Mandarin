#!/bin/sh
# os/build.sh — Mandarin OS's image, os/mandarin-os.raw (os/README.md). Needs mkosi (25 or newer), systemd-boot and
# ukify on the computer it is built on, and the network (Debian's packages, Mandarin's latest release).
set -e
cd "$(dirname "$0")"
install -m 0755 ../tools/linux/install.sh mkosi.extra/usr/lib/mandarin-os/linux-install.sh
install -m 0644 VERSION mkosi.extra/usr/lib/mandarin-os/VERSION
printf 'MANDARIN_OS=%s\n' "$(cat VERSION)" > mkosi.extra/usr/lib/mandarin-os/environment
exec mkosi --image-version "$(cat VERSION)" -ff build "$@"
