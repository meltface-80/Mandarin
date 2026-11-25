# /usr/lib/mandarin-os/boot.sh — how Mandarin OS starts, for its updates in place (item 401, 0.1.4); sourced by the
# installer, os-update and os-started.
#
# The system disk holds the EFI partition and two system partitions, each labelled mandarin-os_<version> (or _empty
# while nothing is written there): the one started, and the other, where the next version is written. systemd-boot
# starts what an entry in loader/entries/ names: a version's unified kernel image (EFI/mandarin-os/), with
# root=PARTUUID= its own partition, so each version starts its own system and never the other's. The newest entry is
# started first. A new version's entry is mandarin-os_<version>+3.conf, three tries (systemd's boot counting): each start
# takes one, and systemd-bless-boot keeps the entry (mandarin-os_<version>.conf) once boot-complete.target is reached,
# which needs os-started's health check on such a start. After three tries that didn't, systemd-boot marks it bad
# (+0-3) and starts the version before, whose partition the update never touched.
#   MANDARIN_OS_ROOT  the tests' own root: every file below it, its commands from PATH; MANDARIN_OS_MANDARIN and
#   MANDARIN_OS_PAGE where Mandarin and the system page answer, and MANDARIN_OS_WAIT how long a start's check waits for
#   Mandarin (seconds), the tests' own
R="${MANDARIN_OS_ROOT:-}"
MANDARIN="${MANDARIN_OS_MANDARIN:-http://127.0.0.1:3500}"
PAGE="${MANDARIN_OS_PAGE:-http://127.0.0.1}"
ROOT_TYPE=4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709   # a system partition (root, x86-64: the Discoverable Partitions Spec's)
ESP_TYPE=C12A7328-F81F-11D2-BA4B-00A0C93EC93B    # the EFI partition
# systemd-boot sets this on a start that is being tried (an entry with tries left); systemd-bless-boot reads it too.
TRYING="$R/sys/firmware/efi/efivars/LoaderBootCountPath-4a67b082-0a4c-41cf-b6c7-440b29bb8c4f"
VER="$(cat "$R/usr/lib/mandarin-os/VERSION" 2>/dev/null)"

# systemd-boot's own variables in the firmware (item 532): the entry kept as its menu's default (bootctl set-default,
# or d pressed in the menu) and the one asked for the next start alone (bootctl set-oneshot). Kept in the computer, not
# on the disk, so a default set any time before, even before this box was installed, outlives a reinstall: one naming
# the version running (the owner's box had mandarin-os_0.1.12.conf kept, harmless while it ran other versions) had
# systemd-boot start that version at every start, and an update's entry was never tried. LOADER_GUID is systemd-boot's.
LOADER_GUID=4a67b082-0a4c-41cf-b6c7-440b29bb8c4f
# systemd-boot's variable $1 as text (its four bytes of attributes, then UTF-16): the entry it names; nothing if unset.
loader_var() { local f="$R/sys/firmware/efi/efivars/$1-$LOADER_GUID"; [ -e "$f" ] && tail -c +5 "$f" 2>/dev/null | tr -d '\0'; return 0; }
# Any default or one-shot entry kept in the firmware let go, so that the newest entry starts (what Mandarin OS's updates
# need); the entries let go said, a line. Not let go: the entry still kept said, and 1.
unpin() {
  local v d f out=""
  for v in LoaderEntryDefault LoaderEntryOneShot; do
    d="$(loader_var "$v")"; [ -n "$d" ] || continue
    f="$R/sys/firmware/efi/efivars/$v-$LOADER_GUID"
    bootctl "$([ "$v" = LoaderEntryDefault ] && echo set-default || echo set-oneshot)" "" >/dev/null 2>&1 || { chattr -i "$f" 2>/dev/null; rm -f "$f"; }
    [ -e "$f" ] && { printf '%s\n' "$d"; return 1; }
    out="$out${out:+, }$d"
  done
  [ -z "$out" ] || printf '%s\n' "$out"
  return 0
}

# Whether $2 is newer than $1 (sort -V's order: 0.1.10 after 0.1.9).
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" = "$2" ]; }

# The partition the system started from; a partition's disk (beside it in /dev); a disk's partition table (sfdisk -J);
# a partition's number (/dev/sda3, /dev/nvme0n1p3: 3).
booted() { readlink -f "$(findmnt -no SOURCE /)"; }
disk_of() { local p; p="$(lsblk -no PKNAME "$1" 2>/dev/null | head -n 1)"; [ -n "$p" ] && printf '%s/%s\n' "${1%/*}" "$p"; }
table() { sfdisk -J "$1"; }
num() { printf '%s\n' "${1##*[!0-9]}"; }

# The EFI partition of disk $1, mounted: where systemd mounts it (/efi, as it is first looked at), or here. Its path.
esp() {
  local part mp
  part="$(table "$1" | jq -r --arg t "$ESP_TYPE" '.partitiontable.partitions[] | select(.type == $t) | .node' | head -n 1)"
  [ -n "$part" ] || return 1
  ls "$R/efi" >/dev/null 2>&1
  mp="$(findmnt -rno TARGET -S "$part" 2>/dev/null | head -n 1)"
  if [ -z "$mp" ]; then
    mp="$R/run/mandarin-os/esp"
    mkdir -p "$mp" && mount -t vfat -o umask=0077 "$part" "$mp" || return 1
  fi
  printf '%s\n' "$mp"
}

# Mandarin OS's entries on the EFI partition $1, a line each: the file, its version, the tries it has left (-1: kept,
# no longer counted) and the partition it starts (PARTUUID, lower case).
entries() {
  local f n v t u
  for f in "$1"/loader/entries/mandarin-os_*.conf; do
    [ -f "$f" ] || continue
    n="$(basename "$f" .conf)"; v="${n#mandarin-os_}"; v="${v%%+*}"
    case "$n" in *+*) t="${n#*+}"; t="${t%%-*}" ;; *) t=-1 ;; esac
    u="$(sed -n 's/^options .*root=PARTUUID=\([0-9A-Fa-f-]*\).*/\1/p' "$f" | tr 'A-F' 'a-f')"
    printf '%s %s %s %s\n' "$f" "$v" "$t" "$u"
  done
}

# Entry $2 taken off the EFI partition $1, and its kernel image where no other entry starts it; on the disk at once (a
# FAT file system keeps what it changed in memory until it is closed, and a power cut then would bring the entry back).
unentry() {
  local efi
  efi="$(sed -n 's/^efi //p' "$2")"
  rm -f "$2"
  [ -n "$efi" ] && ! grep -qxF "efi $efi" "$1"/loader/entries/*.conf 2>/dev/null && rm -f "$1$efi"
  sync -f "$1/loader/entries" 2>/dev/null || sync
  [ ! -e "$2" ]
}

# The entry that starts version $2 from partition $3 (its PARTUUID) on the EFI partition $1, with the kernel image
# EFI/mandarin-os/mandarin-os_$2.efi and its own kernel command line ($4, read from the image itself); $5 the tries
# ("+3" for a new version's, "" for one kept). Written aside, then put in place: never half an entry.
entry() {
  local opts
  opts="root=PARTUUID=$3 rw $(tr ' ' '\n' <<< "$4" | grep -vE '^(root=.*|rw|ro)$' | tr '\n' ' ' | sed 's/ *$//')"
  mkdir -p "$1/loader/entries"
  printf 'title Mandarin OS %s\nversion %s\nefi /EFI/mandarin-os/mandarin-os_%s.efi\noptions %s\n' "$2" "$2" "$2" "$opts" \
    > "$1/loader/entries/mandarin-os_$2.new" || return 1
  sync
  mv -f "$1/loader/entries/mandarin-os_$2.new" "$1/loader/entries/mandarin-os_$2$5.conf" && sync
}
