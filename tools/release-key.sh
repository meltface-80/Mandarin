#!/bin/sh
# tools/release-key.sh [FILE] — Mandarin's release key made (item 371, the security audit's ninth finding), on your own
# computer: an EC P-256 private key in FILE (mandarin-release-key.pem by default), and its public half printed.
#
# The private half signs each release (.github/sign.sh): it goes into the repository's RELEASE_SIGNING_KEY secret and a
# safe place of your own, never the repository or a chat. The public half goes into both programs
# (server/Mandarin.Server/Admin/ReleaseKey.cs, bridge/linux/Mandarin.Bridge/ReleaseKey.cs), which then refuse an
# update not signed with it. Lose the private half and the next update must be installed by hand (the Linux
# installer's line, Mandarin OS's Reinstall, the Bridge's install.sh), carrying a new public half.
set -e
key=${1:-mandarin-release-key.pem}
[ -e "$key" ] && { echo "release-key: $key is there already; kept, nothing made" >&2; exit 1; }
umask 077
openssl ecparam -name prime256v1 -genkey -noout -out "$key"
pub=$(openssl ec -in "$key" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
cat <<MSG
Made $key, the private half. Keep a copy somewhere safe, offline, and give it to no one.

1. Put it in the repository's secret: GitHub, the repository, Settings, Secrets and variables, Actions,
   New repository secret, named RELEASE_SIGNING_KEY, its value the whole of $key. Or:
     gh secret set RELEASE_SIGNING_KEY < $key
2. The public half, safe to share, goes into both programs (BuiltIn in each ReleaseKey.cs):
$pub
MSG
