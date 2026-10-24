#!/usr/bin/env bash
# .github/mac-smoke.sh: Mandarin on a Mac, the short way (item 153). The server built for this Mac
# is started on a library of one album, as the installer starts it, and has to come up, say its
# version and scan the album: the Mac's own layer (its file system calls, libSystem, the tag
# reader with Homebrew's ffmpeg) end to end. The whole suite runs on Linux (ci.yml); running it on
# GitHub's few, slow Macs held builds up and lost its logs when one hung, for code that is the
# same on both.
set -euo pipefail
bin=${1:-server/bin/mandarin-server}
v=$(node -p "require('./package.json').version")
work=$(mktemp -d)
mkdir -p "$work/music/Smoke Artist/Smoke Album" "$work/data"
ffmpeg -loglevel error -f lavfi -i "sine=frequency=440:duration=2" -ac 2 \
  -metadata title="One" -metadata artist="Smoke Artist" -metadata album="Smoke Album" -metadata track=1 \
  "$work/music/Smoke Artist/Smoke Album/01 One.flac"

test "$("$bin" --version)" = "$v"
echo "says $v"

port=3599
PORT=$port MUSIC_DIR="$work/music" DATA_DIR="$work/data" MANDARIN_APP_DIR="$PWD" "$bin" > "$work/server.log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; sleep 1; cat "$work/server.log" | tail -30' EXIT

health=""
for _ in $(seq 1 90); do
  health=$(curl -fs "http://127.0.0.1:$port/api/health" || true)
  case "$health" in *'"albums":1'*) break ;; esac
  kill -0 "$pid" 2>/dev/null || { echo "the server stopped"; exit 1; }
  sleep 1
done
echo "$health"
case "$health" in *'"albums":1'*) ;; *) echo "the album wasn't scanned in 90 s"; exit 1 ;; esac
case "$health" in *"\"version\":\"$v\""*) ;; *) echo "the server didn't say $v"; exit 1 ;; esac
PORT=$port "$bin" --health
echo "started, scanned the album, healthy"
