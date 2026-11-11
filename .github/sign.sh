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
# The key as pasted, put back in shape: a phone's copy can join its lines or turn them into spaces, Windows' adds CRs,
# and anything after the END line (the public half printed beside it) isn't the key's. Only what is between the BEGIN
# and END lines is taken, its base64 in lines of 64 again, under the label it was pasted with.
raw=$(printf '%s' "$RELEASE_SIGNING_KEY" | tr -d '\r' | tr '\n\t' '  ')
label=$(printf '%s' "$raw" | sed -n 's/.*-\{4,5\}BEGIN \([A-Z ]*[A-Z]\) *-\{4,5\}.*/\1/p')
body=$(printf '%s' "$raw" | sed -e 's/.*-\{4,5\}BEGIN [A-Z ]*-\{4,5\}//' -e 's/-\{4,5\}END [A-Z ]*-\{4,5\}.*//' | tr -d ' ')
{ echo "-----BEGIN ${label:-EC PRIVATE KEY}-----"; printf '%s\n' "$body" | fold -w 64; echo "-----END ${label:-EC PRIVATE KEY}-----"; } > "$k"
have=$(openssl ec -in "$k" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
if [ -z "$have" ]; then
  # What it looked like, never what it holds: enough to say what was lost in the pasting.
  lines=$(printf '%s\n' "$RELEASE_SIGNING_KEY" | wc -l | tr -d ' ')
  case "$raw" in *BEGIN*) b=yes ;; *) b=no ;; esac
  case "$raw" in *END*) e=yes ;; *) e=no ;; esac
  echo "::error::RELEASE_SIGNING_KEY isn't an EC private key (PEM): $lines line(s), BEGIN line $b, END line $e, ${#body} characters of key between them (a P-256 key has about 160)" >&2
  exit 1
fi
if [ -n "$pub" ] && [ "$have" != "$pub" ]; then
  echo "::error::RELEASE_SIGNING_KEY isn't the key whose public half the programs carry (Admin/ReleaseKey.cs)" >&2
  exit 1
fi
for f; do
  openssl dgst -sha256 -sign "$k" -out "$f.sig" "$f"
  echo "sign: $f.sig" >&2
done
