#!/bin/bash
# os/ffmpeg/build.sh PREFIX [DESTDIR] | --fetch DIR — ffmpeg for Mandarin OS (configure.flags says what it keeps and why), built from
# Debian 13's own source package, its patches applied, so it is the ffmpeg Debian ships and patches for security, at
# Debian's newest version for trixie (or FFMPEG_DEBIAN_VERSION, e.g. 7:7.1.5-0+deb13u1). Needs a C compiler, nasm,
# pkg-config and the -dev packages of soxr, opus, mp3lame, gnutls, freetype, zlib and bzip2. --fetch DIR: the source
# alone, checked, patched and kept in DIR with its version (the image's build fetches outside the image, builds inside).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
FETCH=0
if [ "${1:-}" = --fetch ]; then FETCH=1; FFMPEG_SRC="${2:?the folder}"; else PREFIX="${1:?the prefix, e.g. /usr/local}" DEST="${2:-}"; fi
[ -z "${FFMPEG_DEBIAN_VERSION:-}" ] && [ -f "${FFMPEG_SRC:-$here/src}/version" ] && FFMPEG_DEBIAN_VERSION="$(cat "${FFMPEG_SRC:-$here/src}/version")"
POOL=https://deb.debian.org/debian/pool/main/f/ffmpeg
if [ -z "${FFMPEG_DEBIAN_VERSION:-}" ]; then
  FFMPEG_DEBIAN_VERSION="$(for s in trixie-security/updates trixie; do
    base=https://deb.debian.org/debian; [ "$s" != trixie ] && base=https://security.debian.org/debian-security
    curl -fsSL "$base/dists/$s/main/binary-amd64/Packages.xz" 2>/dev/null | xz -dc | awk '$1 == "Package:" { p = $2 } p == "ffmpeg" && $1 == "Version:" { print $2 }'
  done | sort -V | tail -n 1)"
fi
[ -n "$FFMPEG_DEBIAN_VERSION" ] || { echo "Debian's ffmpeg version couldn't be found" >&2; exit 1; }
v="${FFMPEG_DEBIAN_VERSION#*:}"; up="${v%-*}"
src="${FFMPEG_SRC:-$here/src}/$v"
echo "ffmpeg $up (Debian $FFMPEG_DEBIAN_VERSION)"
if [ ! -f "$src/.ready" ]; then
  mkdir -p "$src"
  pool="$POOL"; curl -fsI "$POOL/ffmpeg_$up.orig.tar.xz" >/dev/null 2>&1 || pool="https://security.debian.org/debian-security/pool/updates/main/f/ffmpeg"
  curl -fsSL --retry 3 -o "$src/orig.tar.xz" "$pool/ffmpeg_$up.orig.tar.xz"
  curl -fsSL --retry 3 -o "$src/debian.tar.xz" "$pool/ffmpeg_$v.debian.tar.xz"
  curl -fsSL --retry 3 -o "$src/ffmpeg.dsc" "$pool/ffmpeg_$v.dsc"
  # Each file as the .dsc names it (its SHA-256).
  for f in orig debian; do
    name="$([ $f = orig ] && echo "ffmpeg_$up.orig.tar.xz" || echo "ffmpeg_$v.debian.tar.xz")"
    want="$(awk -v n="$name" '/^Checksums-Sha256:/ { on = 1; next } /^[A-Z]/ { on = 0 } on && $3 == n { print $1 }' "$src/ffmpeg.dsc")"
    [ "$(sha256sum "$src/$f.tar.xz" | cut -d' ' -f1)" = "$want" ] || { echo "$name isn't what Debian's .dsc says" >&2; exit 1; }
  done
  tar -xJf "$src/orig.tar.xz" -C "$src"
  tree="$(find "$src" -mindepth 1 -maxdepth 1 -type d -name 'ffmpeg*' | head -n 1)"
  tar -xJf "$src/debian.tar.xz" -C "$tree"
  if [ -f "$tree/debian/patches/series" ]; then
    grep -v '^#' "$tree/debian/patches/series" | while read -r p; do [ -n "$p" ] && patch -d "$tree" -p1 -s < "$tree/debian/patches/$p"; done
  fi
  touch "$src/.ready"
fi
echo "$FFMPEG_DEBIAN_VERSION" > "${FFMPEG_SRC:-$here/src}/version"
[ "$FETCH" = 1 ] && { echo "ffmpeg $up's source in $src"; exit 0; }
tree="$(find "$src" -mindepth 1 -maxdepth 1 -type d -name 'ffmpeg*' | head -n 1)"
cd "$tree"
# shellcheck disable=SC2046
./configure --prefix="$PREFIX" $(grep -v '^#' "$here/configure.flags") --extra-version="mandarin-$v" >/dev/null
make -j"$(nproc)" >/dev/null
make install ${DEST:+DESTDIR="$DEST"} >/dev/null
echo "$FFMPEG_DEBIAN_VERSION" > "${DEST}${PREFIX}/share/ffmpeg/debian-version"
echo "ffmpeg $up built into ${DEST}${PREFIX}"
