#!/bin/sh
# The server's container starts here (item 354, the security audit's third finding): as root, it hands what the
# server writes to the user it runs as, then runs the server as that user, never as root.
#
# PUID and PGID: the user and group the server runs as, 1000 by default (the first user on most machines; give the
# owner of your music if it can't read it). PUID=0 keeps it root, as before 354. Started with docker's --user, it is
# that user already, and runs as it.
#
# The server writes its data (/app/data) and, when it updates itself, its program and page (/app/server, /app/public,
# /app/sq-tool): each handed over when anything in it isn't the user's, so an install from before 354 keeps its library.
# Anything, not just the folder (item 374): a data folder mounted from the host is often the host user's already while
# what the root server wrote inside it (the built-in Tailscale's state, the library) is root's, which the server, no
# longer root, then can't open.
# It keeps one of root's rights, a port under 1024 (PORT=80, say), and a second where the container was given it
# (cap_add SYS_NICE): playback started at a higher priority. SSDP's port, 1900, needs neither.
set -e
uid=${PUID:-1000}
gid=${PGID:-1000}
case "$uid$gid" in *[!0-9]*|'') echo "entrypoint: PUID and PGID are numbers (PUID=$uid PGID=$gid)" >&2; exit 64 ;; esac
if [ "$(id -u)" != 0 ] || [ "$uid" = 0 ]; then exec "$@"; fi

for d in /app/data /app/server /app/public /app/sq-tool /app/package.json; do
  [ -e "$d" ] || continue
  if [ -n "$(find "$d" \( \! -user "$uid" -o \! -group "$gid" \) -print -quit 2>/dev/null)" ]; then
    echo "entrypoint: $d handed to $uid:$gid" >&2
    chown -R "$uid:$gid" "$d"
  fi
done

# A home of its own: fontconfig's and Python's caches.
export HOME=/tmp/mandarin-home
mkdir -p "$HOME" && chown "$uid:$gid" "$HOME"

# The rights it keeps, where the container has them at all (its bounding set, /proc/self/status).
bnd=$(sed -n 's/^CapBnd:[[:space:]]*//p' /proc/self/status)
caps=""
[ $(( (0x$bnd >> 10) & 1 )) = 1 ] && caps="$caps,+net_bind_service"
[ $(( (0x$bnd >> 23) & 1 )) = 1 ] && caps="$caps,+sys_nice"
caps=${caps#,}
if [ -n "$caps" ]; then
  exec setpriv --reuid "$uid" --regid "$gid" --clear-groups --inh-caps "$caps" --ambient-caps "$caps" -- "$@"
fi
exec setpriv --reuid "$uid" --regid "$gid" --clear-groups -- "$@"
