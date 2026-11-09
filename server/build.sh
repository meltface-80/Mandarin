#!/bin/sh
# Builds Mandarin's C# server for this machine (or for RID, e.g. linux-arm64,
# osx-arm64)
# into server/bin/mandarin-server: one self-contained file, no .NET needed to
# run it. Needs the .NET 10 SDK.
set -e
cd "$(dirname "$0")"
case "$(uname -s)" in Darwin) OS=osx ;; *) OS=linux ;; esac
RID=${RID:-$OS-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')}
VERSION=${VERSION:-$(grep -m1 '"version"' ../package.json | cut -d'"' -f4)}
VERSION=${VERSION:-0.0.0}
dotnet publish Mandarin.Server/Mandarin.Server.csproj -c Release -r "$RID" -p:Version="$VERSION" \
  -p:SelfContained=true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true \
  -o bin/"$RID" --nologo -v quiet
# Put in place by a rename, never copied over (item 382): a server still running from this file (one a test left behind)
# makes cp fail with "Text file busy", as it stopped the v1.2.5 release's build; a rename replaces it, the running one
# keeping the file it started from.
cp bin/"$RID"/mandarin-server bin/mandarin-server.new
mv -f bin/mandarin-server.new bin/mandarin-server
rm -f bin/"$RID"/*.pdb bin/"$RID"/*.dbg
echo "mandarin-server $VERSION ($RID)"
