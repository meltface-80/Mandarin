#!/usr/bin/env bash
# .github/gradle-retry.sh <gradle args…>: ./gradlew, run from the Gradle project's folder, tried again (three tries in
# all, 30 s then 90 s apart) where it failed fetching what it needs, Gradle itself or a library, with a server's error
# or a broken connection (item 350: on 8 Nov 2026 GitHub's release downloads, where services.gradle.org sends the
# wrapper and Maven Central some of Kotlin's jars, answered 504 for hours and every dev APK failed before it was
# built). A build that fails on its own, a compile error or a failing task, is not tried again.
set -uo pipefail
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
