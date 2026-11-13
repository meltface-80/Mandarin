#!/bin/bash
# os/mandarin-from-source.sh OUT — Mandarin built from this checkout as a release builds it, for an image of Mandarin OS
# that carries dev's Mandarin rather than the last release (test-os: Mandarin OS as dev is now, item 389): the server
# (server/build.sh), its audio engine (engine/build.sh), and the page bundle (.github/server-assets.sh, as a release makes them), at dev's test version
# (tools/test-version.js: the release after it is offered over it). Laid out as a release's download folder, each file
# signed with a key made for this build alone, so tools/linux/install.sh installs it as it installs a release, checked.
# Needs the .NET 10 SDK, node, openssl.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
V="$(node tools/test-version.js)"
echo "Mandarin $V from this checkout"
rm -rf "$OUT"/*; mkdir -p "$OUT/v$V"
VERSION="$V" RID=linux-x64 ./server/build.sh >/dev/null
[ "$(server/bin/linux-x64/mandarin-server --version)" = "$V" ] || { echo "the server didn't build at $V" >&2; exit 1; }
gzip -9 -c server/bin/linux-x64/mandarin-server > "$OUT/v$V/mandarin-server-linux-x64.gz"
RID=linux-x64 ./engine/build.sh >/dev/null && cp engine/bin/mandarin-audio "$OUT/mandarin-audio"
.github/server-assets.sh bundle "$V" "$OUT/v$V" >/dev/null
openssl ecparam -name prime256v1 -genkey -noout -out "$OUT/build.key" 2>/dev/null
for f in "$OUT/v$V"/*; do openssl dgst -sha256 -sign "$OUT/build.key" -out "$f.sig" "$f"; done
openssl ec -in "$OUT/build.key" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n' > "$OUT/build.pub"
rm -f "$OUT/build.key"
echo "$V" > "$OUT/version"
echo "Mandarin $V ready in $OUT"
