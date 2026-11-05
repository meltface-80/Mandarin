#!/bin/sh
# Builds Mandarin Bridge for Linux for this machine (or for RID, e.g. linux-arm64 for a Raspberry Pi) into
# bridge/linux/bin/mandarin-bridge: one native program, no .NET needed to run it, beside the audio engine it plays
# with (engine/build.sh, built for the same RID). Needs the .NET 10 SDK and clang (Native AOT).
set -e
cd "$(dirname "$0")"
RID=${RID:-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')}
# The Bridge's version, one for every Bridge: the Android app's versionName (item 293; it was the server's).
VERSION=${VERSION:-$(sed -n 's/^ *versionName = "\([^"]*\)".*/\1/p' ../android/app/build.gradle.kts | head -1)}
VERSION=${VERSION:-0.0.0}
# The commit it is built from, after the version's + (Program.Commit): which build it is (item 291).
COMMIT=${COMMIT:-$(git rev-parse --short=7 HEAD 2>/dev/null || echo local)}
dotnet publish Mandarin.Bridge/Mandarin.Bridge.csproj -c Release -r "$RID" -p:Version="$VERSION" -p:SourceRevisionId="$COMMIT" -o bin/"$RID" --nologo -v quiet
cp bin/"$RID"/mandarin-bridge bin/mandarin-bridge
rm -f bin/"$RID"/*.dbg
if [ "$RID" = "linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')" ]; then ./bin/mandarin-bridge --version; else echo "mandarin-bridge $VERSION ($RID)"; fi
