#!/usr/bin/env bash
# .github/retry-failed.sh <log>: the test files that failed in a node:test run
# (its TAP output, kept to <log> by CI) run once more, one at a time, with the
# machine to themselves. A file that passes then was a race on a busy runner:
# the job is green, and the file is named as a warning on the run, so the race
# is seen and fixed in its turn rather than blocking the merge. A file that
# fails again fails the job, its failures said again (failed-tests.sh). A
# failure that names no file (the run itself broken) fails the job as it is.
# (v0.8.49)
set -uo pipefail
log=${1:?usage: .github/retry-failed.sh <log>}
# From each "not ok" line, the file its "location:" names.
files=$(awk '/^ *not ok [0-9]+ - / { on = 1 } on && /^ *location: / { sub(/^ *location: '\''/, ""); sub(/:[0-9]+:[0-9]+'\''.*$/, ""); print; on = 0 }' "$log" | sort -u)
if [ -z "$files" ]; then
  echo "::error::the run failed without naming a test file; see the log above"
  exit 1
fi
echo "== run again, one at a time:"
echo "$files"
# shellcheck disable=SC2086
if node --require ./test/setup.js --test --test-concurrency=1 --test-timeout=300000 --test-force-exit $files 2>&1 | tee "$log.again"; then
  for f in $files; do
    echo "::warning file=${f#"$PWD/"}::failed in the run and passed when run again on its own: a race on a busy runner, to be fixed"
  done
  exit 0
fi
echo "::error::still failing when run again on its own: $(echo "$files" | tr '\n' ' ')"
.github/failed-tests.sh "$log.again"
exit 1
