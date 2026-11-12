#!/bin/bash
# os/test/next-mandarin.sh OUT — "the next Mandarin" for the boot test's in-app update (item 398): Mandarin's server
# built from this checkout as server/build.sh builds it, but as 9.9.9, a version newer than any the image carries, into
# OUT/mandarin-server. os/test/fake-release.js offers it, with this checkout's page, as a release signed with a key of
# the test's own. Built apart (its own obj and bin under OUT), so the image's build of the same checkout is untouched.
# Run as the user who builds (not root: .NET's folders stay theirs). Needs the .NET 10 SDK.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
NEXT=9.9.9
dotnet publish server/Mandarin.Server/Mandarin.Server.csproj -c Release -r linux-x64 -p:Version="$NEXT" \
  -p:SelfContained=true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true \
  --artifacts-path "$OUT/artifacts" -o "$OUT/publish" --nologo -v quiet
mv -f "$OUT/publish/mandarin-server" "$OUT/mandarin-server"
rm -rf "$OUT/publish" "$OUT/artifacts"
[ "$("$OUT/mandarin-server" --version)" = "$NEXT" ] || { echo "the next Mandarin didn't build as $NEXT" >&2; exit 1; }
echo "Mandarin $NEXT in $OUT/mandarin-server"
