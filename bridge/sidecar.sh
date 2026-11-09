#!/bin/sh
# bridge/sidecar.sh FILE COMMIT VERSION — FILE.json beside a Bridge build as it is published (item 291): which build
# it is (its commit, as the Bridge says its own in /dac.json), its version, and its SHA-256. Mandarin's Settings →
# Updates compares the commit with each Bridge's; the Bridge checks the download against the checksum before it
# installs it (Update.cs, Updater.kt). A Linux tarball's signed with Mandarin's release key where there is one (item
# 371, .github/sign.sh): "sig", base64 of the signature of FILE, which the Linux Bridge checks too (ReleaseKey.cs).
set -e
[ $# -eq 3 ] || { echo "usage: $0 FILE COMMIT VERSION" >&2; exit 2; }
sha=$(sha256sum "$1" | cut -d' ' -f1)
sig=""
# The Linux Bridge's tarball alone: an APK is checked by Android, against the key it was signed with.
case "$1" in *.tar.gz) rm -f "$1.sig"; "$(dirname "$0")/../.github/sign.sh" "$1" ;; esac
if [ -f "$1.sig" ]; then sig=$(printf ',"sig":"%s"' "$(base64 < "$1.sig" | tr -d '\n')"); rm -f "$1.sig"; fi
printf '{"commit":"%s","version":"%s","sha256":"%s"%s}\n' "$(printf %s "$2" | cut -c1-7)" "$3" "$sha" "$sig" > "$1.json"
cat "$1.json"
