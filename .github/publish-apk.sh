#!/usr/bin/env bash
# .github/publish-apk.sh <apk>: the Android app built on a push to main put in
# dist/ (android.yml, v0.8.32) as dist/mandarin-android.apk, dist/latest.json
# saying its version, address and sum, through a pull request opened and
# merged here (v1.0.0). Run at the top of the repository, on the commit the app
# was built from, with GITHUB_REF_NAME, GITHUB_SHA and GITHUB_REPOSITORY set
# and gh signed in.
#
# The commit is made on the branch as it is now, not on the commit
# the app was built from: two merges close together, the second's run ending
# first, and the first's publish then changed dist/ under the second's, whose
# pull request could never merge, re-run or not. The branch already carrying
# this version, or a newer one (the later merge's run ended first), is left as
# it is. The same version built again with a higher versionCode (a fix folded
# into a version already out, bug list item 115) replaces it: latest.json says
# the code it carries. Its short notes (item 223), the version's "- Fixed - …"
# lines in CHANGELOG.md (tools/release-notes.js), go in it too: Settings →
# Updates shows them under the app's button.
set -euo pipefail
src=${1:?usage: .github/publish-apk.sh <apk>}
base=${GITHUB_REF_NAME:?}
version=$(grep -oP 'versionName = "\K[^"]+' android/app/build.gradle.kts)
code=$(grep -oP 'versionCode = \K[0-9]+' android/app/build.gradle.kts || true)
apk=$(basename "$src")
OUT=mandarin-android.apk
# Read from the commit the app was built from, before the branch is checked out over it.
notes=$(node "$(dirname "$0")/../tools/release-notes.js" "$version")

git fetch -q origin "$base"
had=$(git show "origin/$base:dist/latest.json" 2>/dev/null | grep -oP '"version": "\K[^"]+' || true)
if [ -n "$had" ] && [ "$had" != "$version" ] && [ "$(printf '%s\n%s\n' "$had" "$version" | sort -V | tail -n 1)" = "$had" ]; then
  echo "$base already carries $had, newer than $version: left as it is"
  exit 0
fi

# The app kept aside: the branch as it is now is checked out over the build.
keep=$(mktemp -d)
cp "$src" "$keep/$apk"
git checkout -q -B publish-apk "origin/$base"
if [ -f "dist/$OUT" ] && grep -q "\"version\": \"$version\"" dist/latest.json && grep -q "\"file\": \"$apk\"" dist/latest.json \
  && [ "$(grep -oP '"code": \K[0-9]+' dist/latest.json || true)" = "$code" ]; then
  echo "$version already published"
  exit 0
fi
git rm -q --ignore-unmatch 'dist/musicd-server-android-*.apk' 'dist/Mandarin-Android-*.apk' "dist/$OUT"
mkdir -p dist
cp "$keep/$apk" "dist/$OUT"
sha=$(sha256sum "dist/$OUT" | cut -d' ' -f1)
printf '{\n  "version": "%s",\n%b  "url": "https://github.com/%s/raw/main/dist/%s",\n  "sha256": "%s",\n  "file": "%s",\n  "notes": %s\n}\n' \
  "$version" "${code:+  \"code\": $code,\n}" "$GITHUB_REPOSITORY" "$OUT" "$sha" "$apk" "$notes" > dist/latest.json
git add "dist/$OUT" dist/latest.json
git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git commit -q -m "Publish $OUT ($apk)" -m "Built from ${GITHUB_SHA}."
branch="publish-apk/$version"
git push -q --force origin "HEAD:refs/heads/$branch"
# Run again (a re-run, or the next commit), the pull request already open is used.
pr=$(gh pr list --head "$branch" --base "$base" --state open --json url -q '.[0].url')
[ -n "$pr" ] || pr=$(gh pr create --base "$base" --head "$branch" --title "Publish $OUT ($apk)" \
  --body "The Android app $version for dist/, built from ${GITHUB_SHA} once CI passed on it. Opened and merged by the Android workflow.")
gh pr merge "$pr" --squash --delete-branch
