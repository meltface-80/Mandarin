#!/bin/sh
# Builds Mandarin's C# server for this machine (or for RID, e.g. linux-arm64,
# osx-arm64)
# into server/bin/mandarin-server: one self-contained file, no .NET needed to
# run it. Needs the .NET 10 SDK.
set -e
cd "$(dirname "$0")"
case "$(uname -s)" in Darwin) OS=osx ;; *) OS=linux ;; esac
RID=${RID:-$OS-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')}
VERSION=${VERSION:-$(node -p "require('../package.json').version" 2>/dev/null || echo 0.0.0)}
dotnet publish Mandarin.Server/Mandarin.Server.csproj -c Release -r "$RID" -p:Version="$VERSION" \
  -p:SelfContained=true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true \
  -o bin/"$RID" --nologo -v quiet
cp bin/"$RID"/mandarin-server bin/mandarin-server
rm -f bin/"$RID"/*.pdb bin/"$RID"/*.dbg
echo "mandarin-server $VERSION ($RID)"
