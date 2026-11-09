#!/bin/sh
# .github/sign.sh FILE... — each FILE signed with Mandarin's release key (item 371, the security audit's ninth finding):
# FILE.sig beside it, ECDSA P-256 over SHA-256, DER (openssl dgst -sha256 -sign), which the server's updater checks
# (Admin/ReleaseKey.cs) and, base64 in its sidecar (bridge/sidecar.sh), the Linux Bridge's.
#
# The key is the RELEASE_SIGNING_KEY secret (PEM; made with tools/release-key.sh, its public half built into the
# programs). With none: nothing signed while the programs carry no key, as before; once they carry one, a build that
# may be published fails, since every install would refuse it. A pull request's, never published, only says so.
# The secret must be the key whose public half they carry. RELEASE_KEY_PUB names another public half (the tests').
set -e
here=$(dirname "$0")
pub=${RELEASE_KEY_PUB-$(sed -n 's/.*const string BuiltIn = "\([^"]*\)".*/\1/p' "$here/../server/Mandarin.Server/Admin/ReleaseKey.cs")}
if [ -z "$RELEASE_SIGNING_KEY" ]; then
  [ -z "$pub" ] && { echo "sign: no release key yet (tools/release-key.sh): $* not signed" >&2; exit 0; }
  [ "$GITHUB_EVENT_NAME" = pull_request ] && { echo "sign: a pull request's build, not signed (no RELEASE_SIGNING_KEY)" >&2; exit 0; }
  echo "::error::the programs check updates against a release key (Admin/ReleaseKey.cs), and the RELEASE_SIGNING_KEY secret isn't set: no install would take this build" >&2
  exit 1
fi
k=$(mktemp)
trap 'rm -f "$k"' EXIT
printf '%s\n' "$RELEASE_SIGNING_KEY" > "$k"
have=$(openssl ec -in "$k" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
[ -n "$have" ] || { echo "::error::RELEASE_SIGNING_KEY isn't an EC private key (PEM)" >&2; exit 1; }
if [ -n "$pub" ] && [ "$have" != "$pub" ]; then
  echo "::error::RELEASE_SIGNING_KEY isn't the key whose public half the programs carry (Admin/ReleaseKey.cs)" >&2
  exit 1
fi
for f; do
  openssl dgst -sha256 -sign "$k" -out "$f.sig" "$f"
  echo "sign: $f.sig" >&2
done
