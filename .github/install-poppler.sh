#!/usr/bin/env bash
# .github/install-poppler.sh — poppler (pdftoppm) on a CI runner, for the booklet tests (test/booklets-csharp.test.js).
#
# The runner's own Ubuntu mirrors can be out for hours: on 11 Nov 2026 azure.archive.ubuntu.com, archive.ubuntu.com and
# security.ubuntu.com all timed out on every runner, and every CI run failed here before a test ran. They are tried
# first, briefly; then the same archive from other mirrors, each try bounded, until one gives the package. Nothing is
# skipped: without pdftoppm this fails, and the booklet tests (which CI requires) with it.
set -uo pipefail
if command -v pdftoppm >/dev/null; then pdftoppm -v; exit 0; fi
opts=(-q -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o Acquire::Retries=1)
try() { timeout 150 sudo apt-get update "${opts[@]}" && timeout 150 sudo apt-get install -y --no-install-recommends "${opts[@]}" poppler-utils; }
try && { pdftoppm -v; exit 0; }
prev=""
for mirror in http://mirrors.edge.kernel.org/ubuntu http://mirror.math.princeton.edu/pub/ubuntu http://ftp.halifax.rwth-aachen.de/ubuntu; do
  echo "::warning::Ubuntu's own mirrors didn't give poppler: trying $mirror"
  # The runner's lists name its mirror list (mirror+file:/etc/apt/apt-mirrors.txt) or the archive's hosts: both point here.
  [ -f /etc/apt/apt-mirrors.txt ] && echo "$mirror" | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    sudo sed -i -E "s#(https?://([a-z0-9-]+\.)?archive\.ubuntu\.com/ubuntu|https?://security\.ubuntu\.com/ubuntu|mirror\+file:/etc/apt/apt-mirrors\.txt${prev:+|$prev})/?#$mirror#g" "$f"
  done
  prev=$mirror
  try && { pdftoppm -v; exit 0; }
done
echo "::error::poppler couldn't be installed from Ubuntu's mirrors or the others tried" >&2
exit 1
