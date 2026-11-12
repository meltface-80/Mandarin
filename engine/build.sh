#!/bin/sh
# Builds Mandarin's audio engine for this machine (or for RID, e.g. linux-arm64)
# into engine/bin/mandarin-audio: one native program, no .NET needed to run it.
# Needs the .NET 10 SDK and clang (Native AOT).
set -e
cd "$(dirname "$0")"
RID=${RID:-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')}
VERSION=${VERSION:-$(grep -m1 '"version"' ../package.json | cut -d'"' -f4)}
VERSION=${VERSION:-0.0.0}
dotnet publish Mandarin.Audio/Mandarin.Audio.csproj -c Release -r "$RID" -p:Version="$VERSION" -o bin/"$RID" --nologo -v quiet
cp bin/"$RID"/mandarin-audio bin/mandarin-audio
rm -f bin/"$RID"/*.dbg
# Asked its version where it runs here (a build for another platform can't be).
if [ "$RID" = "linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')" ]; then ./bin/mandarin-audio --version; else echo "mandarin-audio $VERSION ($RID)"; fi
