#!/bin/sh
# os/build.sh — Mandarin OS's image, os/mandarin-os.raw (os/README.md). Needs mkosi (25 or newer), systemd-boot and
# ukify on the computer it is built on, and the network (Debian's packages, Mandarin's latest release).
set -e
cd "$(dirname "$0")"
# Mandarin: built from this checkout (test images, MANDARIN_FROM=source, the default), or the latest release
# (MANDARIN_FROM=release, a numbered Mandarin OS release).
if [ "${MANDARIN_FROM:-source}" = source ]; then ./mandarin-from-source.sh "$PWD/mandarin-src"; else rm -rf "$PWD/mandarin-src"; fi
install -m 0755 ../tools/linux/install.sh mkosi.extra/usr/lib/mandarin-os/linux-install.sh
install -m 0644 VERSION mkosi.extra/usr/lib/mandarin-os/VERSION
printf 'MANDARIN_OS=%s\n' "$(cat VERSION)" > mkosi.extra/usr/lib/mandarin-os/environment
# Mandarin Bridge, where it is chosen, from the same as Mandarin: dev's (test-bridge) beside dev's Mandarin, so it isn't
# offered an update the moment it is installed; the latest Bridge release beside a released Mandarin.
if [ "${MANDARIN_FROM:-source}" = source ]; then echo test-bridge; else echo release; fi > mkosi.extra/usr/lib/mandarin-os/bridge-from
# Mandarin OS's own updates (os-update, item 401), from the same: a test image follows the test-os pre-release (dev's), a
# released one the newest mandarin-os-v* release.
if [ "${MANDARIN_FROM:-source}" = source ]; then echo test-os; else echo release; fi > mkosi.extra/usr/lib/mandarin-os/update-from
exec mkosi --image-version "$(cat VERSION)" -ff build "$@"
