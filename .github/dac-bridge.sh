#!/usr/bin/env bash
# .github/dac-bridge.sh: Mandarin DAC Bridge (github.com/meltface-80/Mandarin-DAC-Bridge)
# built for this runner at the commit below, for test/dac-bridge.test.js, which
# plays an album through its fake DAC. Its path goes to the job's later steps
# as MANDARIN_DAC_BRIDGE_BIN. Built as one self-contained file rather than
# ahead of time (the same program, without a native toolchain). Move the
# commit on deliberately, when the bridge's renderer changes. (v0.9.0)
set -euo pipefail
COMMIT=8aa589c5c16d45137d4f9a7067a1dbb13e1511d6   # v1.1.14
src="$RUNNER_TEMP/dac-bridge-src" out="$RUNNER_TEMP/dac-bridge"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) rid=linux-x64 ;; Linux-aarch64) rid=linux-arm64 ;;
  Darwin-arm64) rid=osx-arm64 ;; Darwin-x86_64) rid=osx-x64 ;;
  *) echo "no build of the bridge for $(uname -s) $(uname -m)"; exit 1 ;;
esac
git init -q "$src"
git -C "$src" fetch -q --depth 1 https://github.com/meltface-80/Mandarin-DAC-Bridge.git "$COMMIT"
git -C "$src" checkout -q FETCH_HEAD
dotnet publish "$src/src/MandarinDacBridge" -c Release -r "$rid" -p:PublishAot=false -p:SelfContained=true \
  -p:PublishSingleFile=true -o "$out" --nologo
"$out/mandarin-dac-bridge" --version
echo "MANDARIN_DAC_BRIDGE_BIN=$out/mandarin-dac-bridge" >> "$GITHUB_ENV"
