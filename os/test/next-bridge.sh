#!/bin/bash
# os/test/next-bridge.sh OUT — Mandarin Bridge for Linux for the boot test's Bridge update (item 415): built from this
# checkout as bridge/linux/build.sh builds it, twice: as its own version (OUT/installed/mandarin-bridge, installed on the
# box with the service from before 0.3.12) and as 9.9.9 (OUT/next/mandarin-bridge, the update offered it by
# os/test/fake-bridge-release.js), each beside Mandarin's audio engine (engine/build.sh's, OUT/*/mandarin-audio). Built
# apart (their own obj and bin under OUT), so the image's build of the same checkout is untouched. Run as the user who
# builds (not root: .NET's folders stay theirs). Needs the .NET 10 SDK and clang (Native AOT).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
NEXT=9.9.9
OWN="$(sed -n 's/^ *versionName = "\([^"]*\)".*/\1/p' bridge/android/app/build.gradle.kts | head -1)"
COMMIT="$(git rev-parse --short=7 HEAD 2>/dev/null || echo local)"
publish() {  # project, its program, version, into
  dotnet publish "$1" -c Release -r linux-x64 -p:Version="$3" -p:SourceRevisionId="$COMMIT" \
    --artifacts-path "$OUT/artifacts" -o "$OUT/publish" --nologo -v quiet
  mkdir -p "$4" && mv -f "$OUT/publish/$2" "$4/$2"
  rm -rf "$OUT/publish" "$OUT/artifacts"
}
publish engine/Mandarin.Audio/Mandarin.Audio.csproj mandarin-audio 0.0.0 "$OUT/engine"
publish bridge/linux/Mandarin.Bridge/Mandarin.Bridge.csproj mandarin-bridge "$OWN" "$OUT/installed"
publish bridge/linux/Mandarin.Bridge/Mandarin.Bridge.csproj mandarin-bridge "$NEXT" "$OUT/next"
for d in installed next; do cp "$OUT/engine/mandarin-audio" "$OUT/$d/"; done
rm -rf "$OUT/engine"
[ "$("$OUT/installed/mandarin-bridge" --version | cut -d' ' -f2)" = "$OWN" ] || { echo "the Bridge didn't build as $OWN" >&2; exit 1; }
[ "$("$OUT/next/mandarin-bridge" --version | cut -d' ' -f2)" = "$NEXT" ] || { echo "the next Bridge didn't build as $NEXT" >&2; exit 1; }
echo "Mandarin Bridge $OWN in $OUT/installed, $NEXT in $OUT/next"
