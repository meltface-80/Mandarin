#!/usr/bin/env bash
# .github/failed-tests.sh <log>: the tests that failed in a node:test run (its
# TAP output, kept to <log> by CI), each said again with its details, and the
# run's counts. A job's log is read from its tail (GitHub's API gives the last
# few thousand lines), and a long run's failures fall off the top of that: here
# they are at the end, where a read finds them (v0.8.48).
set -u
log=${1:?usage: .github/failed-tests.sh <log>}
echo "== the tests that failed, again =="
# From each "not ok" line to the end of its details (the YAML block's "..."),
# nested ones too.
awk '/^ *not ok [0-9]+ - / { on = 1 } on { print } on && /^ *\.\.\.$/ { on = 0; print "" }' "$log"
grep -E "^# (tests|suites|pass|fail|cancelled|skipped|todo) " "$log" || true
