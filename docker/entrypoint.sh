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
# One it can't hand over (a data folder on an SMB share, on NFS with root_squash) is said and left (item 386): before,
# it stopped the container, which Docker started again, and again; the server says in its turn what it can't write.
#
# Its groups (item 386): PGID, and the groups that own the music folder (MUSIC_DIR, /music) and the folders directly
# in it, so music readable through a group (a NAS's "media", say), which root read, it still reads. Never root's group.
#
# It keeps one of root's rights, a port under 1024 (PORT=80, say), and a second where the container was given it
# (cap_add SYS_NICE): playback started at a higher priority. SSDP's port, 1900, needs neither.
set -e
uid=${PUID:-1000}
gid=${PGID:-1000}
case "$uid$gid" in *[!0-9]*|'') echo "entrypoint: PUID and PGID are numbers (PUID=$uid PGID=$gid)" >&2; exit 64 ;; esac
if [ "$(id -u)" != 0 ] || [ "$uid" = 0 ]; then exec "$@"; fi

# MANDARIN_OWN: what is handed over, the tests' own (test/entrypoint-groups.test.js).
for d in ${MANDARIN_OWN:-/app/data /app/server /app/public /app/sq-tool /app/package.json}; do
  [ -e "$d" ] || continue
  if [ -n "$(find "$d" \( \! -user "$uid" -o \! -group "$gid" \) -print -quit 2>/dev/null)" ]; then
    if chown -R "$uid:$gid" "$d"; then echo "entrypoint: $d handed to $uid:$gid" >&2
    else echo "entrypoint: $d couldn't be handed to $uid:$gid; the server may not write it there (give PUID and PGID of its owner, or PUID=0)" >&2
    fi
  fi
done

# A home of its own: fontconfig's and Python's caches.
export HOME=/tmp/mandarin-home
mkdir -p "$HOME" && chown "$uid:$gid" "$HOME" || echo "entrypoint: $HOME couldn't be handed to $uid:$gid" >&2

# The groups it keeps: its own, and those of the music folders, never root's (0).
music=${MUSIC_DIR:-/music}
groups=$gid
for g in $(find "$music" -maxdepth 1 -type d -printf '%G\n' 2>/dev/null | sort -un); do
  case ",$groups," in *",$g,"*) ;; *) [ "$g" = 0 ] || groups="$groups,$g" ;; esac
done

# The rights it keeps, where the container has them at all (its bounding set, /proc/self/status).
bnd=$(sed -n 's/^CapBnd:[[:space:]]*//p' /proc/self/status)
caps=""
[ $(( (0x$bnd >> 10) & 1 )) = 1 ] && caps="$caps,+net_bind_service"
[ $(( (0x$bnd >> 23) & 1 )) = 1 ] && caps="$caps,+sys_nice"
caps=${caps#,}
if [ -n "$caps" ]; then
  exec setpriv --reuid "$uid" --regid "$gid" --groups "$groups" --inh-caps "$caps" --ambient-caps "$caps" -- "$@"
fi
exec setpriv --reuid "$uid" --regid "$gid" --groups "$groups" -- "$@"
