#!/bin/sh
# bridge/sidecar.sh FILE COMMIT VERSION — FILE.json beside a Bridge build as it is published (item 291): which build
# it is (its commit, as the Bridge says its own in /dac.json), its version, and its SHA-256. Mandarin's Settings →
# Updates compares the commit with each Bridge's; the Bridge checks the download against the checksum before it
# installs it (Update.cs, Updater.kt).
set -e
[ $# -eq 3 ] || { echo "usage: $0 FILE COMMIT VERSION" >&2; exit 2; }
sha=$(sha256sum "$1" | cut -d' ' -f1)
printf '{"commit":"%s","version":"%s","sha256":"%s"}\n' "$(printf %s "$2" | cut -c1-7)" "$3" "$sha" > "$1.json"
cat "$1.json"
