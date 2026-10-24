#!/usr/bin/env bash
# .github/csharp-tests.sh [k/n]: the C# suite (test/Mandarin.Tests, v1.0.6) as
# CI runs it: built once, then the test classes dealt out to n jobs (every nth
# class, by name, from the kth) so the whole run takes the time of a part of
# it, as the Node suite's --test-shard does. A test that fails runs once more
# on its own: a pass then is a warning on the run (a race on a busy runner, to
# be fixed in its turn), a failure again fails the job, as retry-failed.sh has
# it for the Node suite. No argument: every class.
set -uo pipefail
shard=${1:-1/1}
k=${shard%/*}
n=${shard#*/}
proj=test/Mandarin.Tests
dotnet build "$proj" -c Release --nologo -v quiet || exit 1
classes=$(dotnet test "$proj" -c Release --no-build --list-tests 2>/dev/null \
  | sed -n 's/^    \(Mandarin\.Tests\.[A-Za-z0-9_]*\)\.[A-Za-z0-9_]*.*$/\1/p' | sort -u \
  | awk -v k="$k" -v n="$n" '(NR - k) % n == 0')
if [ -z "$classes" ]; then
  echo "no C# test classes in part $shard"
  exit 0
fi
filter=$(printf 'FullyQualifiedName~%s.|' $classes)
filter=${filter%|}
log=${RUNNER_TEMP:-/tmp}/csharp-tests-$k.log
echo "== C# tests, part $shard: $(echo "$classes" | wc -l) classes"
# CLASS_MINUTES set (a Mac, item 153): each class run by itself, stopped and named if it takes longer,
# so a class that hangs doesn't take the whole run (and its log) with it.
if [ -n "${CLASS_MINUTES:-}" ]; then
  : > "$log"
  status=0
  for c in $classes; do
    dotnet test "$proj" -c Release --no-build --nologo --filter "FullyQualifiedName~$c." --logger "console;verbosity=normal" >> "$log" 2>&1 &
    pid=$!
    waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt $((CLASS_MINUTES * 60)) ]; do sleep 5; waited=$((waited + 5)); done
    if kill -0 "$pid" 2>/dev/null; then
      pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
      echo "::error::$c still running after $CLASS_MINUTES minutes: stopped"
      grep -E "^ *(Passed|Failed|Skipped) $c\." "$log" | tail -5
      status=1
      continue
    fi
    wait "$pid" || status=1
    echo "== $c: $(grep -cE "^ *Passed $c\." "$log") passed, $(grep -cE "^ *Failed $c\." "$log") failed"
  done
  [ "$status" -eq 0 ] && exit 0
  cat "$log" | grep -E "^ *Failed |Error Message" -A3 | head -80
else
  dotnet test "$proj" -c Release --no-build --nologo --filter "$filter" --logger "console;verbosity=normal" 2>&1 | tee "$log"
  [ "${PIPESTATUS[0]}" -eq 0 ] && exit 0
fi
failed=$(sed -n 's/^ *Failed \(Mandarin\.Tests\.[A-Za-z0-9_.]*\).*$/\1/p' "$log" | sort -u)
if [ -z "$failed" ]; then
  echo "::error::the C# run failed without naming a test; see the log above"
  exit 1
fi
echo "== the C# tests that failed, run again one at a time:"
echo "$failed"
again=0
for t in $failed; do
  if dotnet test "$proj" -c Release --no-build --nologo --filter "FullyQualifiedName=$t" -- xUnit.MaxParallelThreads=1 2>&1 | tee -a "$log.again"; then
    echo "::warning::$t failed in the run and passed when run again on its own: a race on a busy runner, to be fixed"
  else
    again=1
    echo "::error::$t still fails when run again on its own"
  fi
done
exit $again
