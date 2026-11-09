#!/usr/bin/env bash
# .github/gradle-retry.sh <gradle args…>: ./gradlew, run from the Gradle project's folder, tried again (three tries in
# all, 30 s then 90 s apart) where it failed fetching what it needs, Gradle itself or a library, with a server's error
# or a broken connection (item 350: on 8 Nov 2026 GitHub's release downloads, where services.gradle.org sends the
# wrapper and Maven Central some of Kotlin's jars, answered 504 for hours and every dev APK failed before it was
# built). A build that fails on its own, a compile error or a failing task, is not tried again.
set -uo pipefail

# Gradle itself fetched first by curl (item 381): the wrapper's own download tries once, and on 9 Nov 2026 GitHub's
# release service answered it 504 for every try the three above made, many minutes on end, while curl, trying again for
# up to ten minutes, got it. It is put where the wrapper looks for it (its folder named by the MD5 of the distribution's
# address, in base 36, as the wrapper's PathAssembler names it), and the wrapper checks it against distributionSha256Sum
# as it unpacks it. Where it is there already, or curl can't get it either, the wrapper is left to fetch it as before.
prefetch() {
  local props=gradle/wrapper/gradle-wrapper.properties url name hash dir
  [ -f "$props" ] || return 0
  url=$(sed -n 's/^distributionUrl=//p' "$props" | sed 's/\\:/:/g')
  [ -n "$url" ] || return 0
  name=$(basename "$url" .zip)
  hash=$(python3 -c 'import hashlib,sys
n=int(hashlib.md5(sys.argv[1].encode()).hexdigest(),16); d="0123456789abcdefghijklmnopqrstuvwxyz"; s=""
while n: n,r=divmod(n,36); s=d[r]+s
print(s or "0")' "$url")
  dir="${GRADLE_USER_HOME:-$HOME/.gradle}/wrapper/dists/$name/$hash"
  [ -f "$dir/$name.zip" ] && return 0
  mkdir -p "$dir"
  if curl -fsSL --retry 12 --retry-all-errors --retry-delay "${GRADLE_PREFETCH_DELAY_S:-15}" --retry-max-time 600 -o "$dir/$name.zip.part" "$url"; then
    mv "$dir/$name.zip.part" "$dir/$name.zip"
    echo "Gradle fetched ahead: $dir/$name.zip"
  else
    rm -f "$dir/$name.zip.part"
    echo "::warning::Gradle couldn't be fetched ahead by curl; the wrapper fetches it itself"
  fi
}
[ -n "${GRADLE_PREFETCH_OFF:-}" ] || prefetch

log=$(mktemp)
status=1
for n in 1 2 3; do
  ./gradlew "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  [ "$status" -eq 0 ] && exit 0
  if ! grep -qE "response code: 5[0-9][0-9]|status code 5[0-9][0-9]|Could not (GET|HEAD|download)|Connection reset|Read timed out|connect timed out|Remote host terminated the handshake|Each download failed" "$log"; then
    exit "$status"
  fi
  [ "$n" -eq 3 ] && break
  first=${GRADLE_RETRY_WAIT_S:-30}   # its own test waits less
  wait=$([ "$n" -eq 1 ] && echo "$first" || echo $((first * 3)))
  echo "::warning::Gradle couldn't fetch what it needed (try $n of 3): trying again in ${wait} s"
  sleep "$wait"
done
echo "::error::Gradle couldn't fetch what it needed in three tries: a download it depends on is failing (see above)"
exit "$status"
