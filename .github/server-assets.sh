#!/bin/bash
# .github/server-assets.sh program|bundle VERSION OUT — Mandarin Server's files as the in-app updater takes them
# (server/Mandarin.Server/Admin/Updater.cs), made into the folder OUT; signed after, by .github/sign.sh. A release's
# (release.yml), dev's test build's (server-dev.yml, item 405) and a test image's Mandarin (os/mandarin-from-source.sh)
# are made the same way here.
#   program  mandarin-server-linux-x64.gz and mandarin-server-linux-arm64.gz, each built at VERSION (server/build.sh,
#            self-contained, one file; arm64 cross-built), the x64 one checked to say VERSION, and their SHA-256 sums in
#            mandarin-server.sha256
#   bundle   musicd-server-VERSION.tar.gz: the page, package.json (its version VERSION), README.md, CHANGELOG.md,
#            LICENSE and SQ-tool's Python, under musicd-server/
# Needs the .NET 10 SDK (program), node (bundle).
set -euo pipefail
what="${1:?program|bundle}" v="${2:?the version}" out="${3:?the folder made into}"
cd "$(dirname "$0")/.."
mkdir -p "$out"
out="$(cd "$out" && pwd)"
case "$what" in
  program)
    for rid in linux-x64 linux-arm64; do
      VERSION="$v" RID="$rid" ./server/build.sh
      gzip -9 -c "server/bin/$rid/mandarin-server" > "$out/mandarin-server-$rid.gz"
    done
    said="$(server/bin/linux-x64/mandarin-server --version)"
    [ "$said" = "$v" ] || { echo "the server built says $said, not $v" >&2; exit 1; }
    (cd "$out" && sha256sum mandarin-server-*.gz > mandarin-server.sha256 && cat mandarin-server.sha256)
    ;;
  bundle)
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    mkdir -p "$tmp/musicd-server/sq-tool"
    cp -r package.json public README.md CHANGELOG.md LICENSE "$tmp/musicd-server/"
    cp -r sq-tool/sqtool "$tmp/musicd-server/sq-tool/"
    # Its version VERSION: a release's package.json as it is; a test build's (1.3.2-t5) with its own number in it.
    node -e 'const fs = require("fs"), [f, v] = process.argv.slice(1), p = JSON.parse(fs.readFileSync(f, "utf8"));
      if (p.version !== v) { p.version = v; fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n"); }' "$tmp/musicd-server/package.json" "$v"
    tar -C "$tmp" -czf "$out/musicd-server-$v.tar.gz" musicd-server
    echo "musicd-server-$v.tar.gz"
    ;;
  *) echo "program or bundle, not $what" >&2; exit 2 ;;
esac
