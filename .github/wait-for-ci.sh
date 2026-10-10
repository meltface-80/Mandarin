#!/usr/bin/env bash
# .github/wait-for-ci.sh <commit>: waits for CI (ci.yml), run on a push of that
# commit, to finish, and succeeds only if every run of it passed: Linux, the
# image and the Mac's tests alike. The release and the image wait on it
# (v0.8.31), so nothing reaches anyone before every test has passed.
#
# CI red, then re-run to green: re-run the failed job here too ("Re-run failed
# jobs" on the Release or Publish run), and it finds CI green this time.
set -u
sha=${1:?usage: .github/wait-for-ci.sh <commit>}
for i in $(seq 1 360); do   # every 10 s, for an hour at most
  runs=$(gh run list --workflow ci.yml --commit "$sha" --event push --json status,conclusion,url \
    -q '.[] | "\(.status) \(.conclusion) \(.url)"') || runs=""
  if [ -n "$runs" ]; then
    if ! grep -qv '^completed ' <<<"$runs"; then
      echo "$runs"
      if grep -qv '^completed success ' <<<"$runs"; then
        echo "CI didn't pass on $sha: nothing is published"
        exit 1
      fi
      echo "CI passed on $sha"
      exit 0
    fi
  elif [ "$i" -gt 60 ]; then
    echo "No CI run on $sha after 10 minutes"
    exit 1
  fi
  sleep 10
done
echo "CI on $sha still not finished after an hour"
exit 1
