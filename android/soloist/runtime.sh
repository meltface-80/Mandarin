#!/bin/bash
# runtime.sh — Soloist on the phone's runtime (bug list item 148), made by CI for every APK. Spotify makes Soloist
# for Linux on 64-bit ARM (glibc, Debian 13), the phone's processor; Android has its own C library, not glibc.
# So the app carries what Soloist needs around it, and runs it under proot (as UserLAnd and Termux's proot-distro run
# Debian), which shows Soloist a Debian file tree inside the app's own folder:
#
#   jniLibs/arm64-v8a/  libproot.so, libproot-loader.so, libtalloc.so, libandroid-shmem.so    Termux's proot (Android's C library): the
#                       only programs the app runs itself, from where Android allows it (since Android 10, never
#                       from the app's own storage, where Soloist is downloaded; proot's loader maps it instead)
#   assets/soloist-root/lib/   Debian 13's loader, libc, libm, libatomic and libgcc_s (glibc 2.41, as Spotify tests
#                       Soloist on), and libpulse.so.0: Spotifast's stand-in for PulseAudio (shim/, MIT), which hands
#                       Soloist's sound straight to the app over 127.0.0.1
#
# Soloist itself is never in the APK (Spotify allows no copies): the app downloads it from Spotify, as the server does.
# Run by CI before the APK is built (android.yml); needs curl, xz, dpkg-deb and aarch64-linux-gnu-gcc.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
app="$here/../app/src/main"
jni="$app/jniLibs/arm64-v8a"
root="$app/assets/soloist-root"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rm -rf "$root"
mkdir -p "$jni" "$root/lib/aarch64-linux-gnu"
: > "$root/VERSIONS"

DEBIAN=https://deb.debian.org/debian
TERMUX=https://packages.termux.dev/apt/termux-main

# index <url of Packages, less .xz> <name>: the index, unpacked (or plain, where the mirror keeps no .xz).
CURL=(curl -fsSL --retry 4 --connect-timeout 20 --max-time 300)
index() {
    echo "runtime.sh: index $1"
    if "${CURL[@]}" -o "$work/$2.xz" "$1.xz"; then xz -d < "$work/$2.xz" > "$work/$2"
    else "${CURL[@]}" -o "$work/$2" "$1"; fi
}

# fetch <mirror> <index> <package> <into>: the package named in the index, its SHA-256 checked, unpacked.
fetch() {
    local line file sha ver
    line=$(awk -v p="$3" 'BEGIN { RS = ""; FS = "\n" } {
        n = f = s = v = ""
        for (i = 1; i <= NF; i++) {
            if ($i ~ /^Package: /) n = substr($i, 10)
            else if ($i ~ /^Filename: /) f = substr($i, 11)
            else if ($i ~ /^SHA256: /) s = substr($i, 9)
            else if ($i ~ /^Version: /) v = substr($i, 10)
        }
        if (n == p) { print f, s, v; exit }
    }' "$work/$2")
    read -r file sha ver <<< "$line"
    [ -n "${file:-}" ] || { echo "runtime.sh: $3 isn't in $2" >&2; exit 1; }
    echo "runtime.sh: $3 $ver ($file)"
    "${CURL[@]}" -o "$work/$3.deb" "$1/$file"
    echo "$sha  $work/$3.deb" | sha256sum -c --quiet -
    mkdir -p "$4"
    dpkg-deb -x "$work/$3.deb" "$4"
    echo "$3 $ver" >> "$root/VERSIONS"
}

# Debian 13's glibc and friends, for arm64.
index "$DEBIAN/dists/trixie/main/binary-arm64/Packages" debian
for p in libc6 libatomic1 libgcc-s1; do fetch "$DEBIAN" debian "$p" "$work/deb"; done
for f in ld-linux-aarch64.so.1 libc.so.6 libm.so.6 libatomic.so.1 libgcc_s.so.1; do
    cp -L "$work/deb/usr/lib/aarch64-linux-gnu/$f" "$root/lib/aarch64-linux-gnu/$f"
done
cp -L "$work/deb/usr/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1" "$root/lib/ld-linux-aarch64.so.1"

# Termux's proot and the talloc it links, for aarch64 Android.
index "$TERMUX/dists/stable/main/binary-aarch64/Packages" termux
for p in proot libtalloc libandroid-shmem; do fetch "$TERMUX" termux "$p" "$work/termux-pkgs"; done
usr="$work/termux-pkgs/data/data/com.termux/files/usr"
find "$usr" \( -type f -o -type l \) | sed "s#^$usr/#  #"
cp -L "$usr/bin/proot" "$jni/libproot.so"
cp -L "$usr/libexec/proot/loader" "$jni/libproot-loader.so"
cp -L "$usr/lib/libtalloc.so.2" "$jni/libtalloc.so"
cp -L "$usr/lib/libandroid-shmem.so" "$jni/libandroid-shmem.so"
# What these link, beyond Android's own: each other alone, or the build stops here and says what else.
for f in libproot.so libtalloc.so libandroid-shmem.so; do
    need=$(readelf -d "$jni/$f" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p')
    echo "runtime.sh: $f needs: $(echo $need)"
    for n in $need; do
        case "$n" in libtalloc.so.2|libandroid-shmem.so|libc.so|libdl.so|libm.so|liblog.so) ;; *) echo "runtime.sh: $f also needs $n" >&2; exit 1 ;; esac
    done
done

# Spotifast's PulseAudio stand-in, built for glibc on 64-bit ARM.
echo "runtime.sh: building the PulseAudio stand-in"
aarch64-linux-gnu-gcc -std=gnu11 -O2 -fPIC -fvisibility=hidden -Wall -Wextra -Werror -shared \
    -Wl,-soname,libpulse.so.0 -Wl,-z,relro,-z,now -o "$root/lib/aarch64-linux-gnu/libpulse.so.0" \
    "$here/shim/pulse-shim.c" -lpthread -lm
aarch64-linux-gnu-strip --strip-unneeded "$root/lib/aarch64-linux-gnu/libpulse.so.0"
echo "pulse-shim spotifast-lossless@1eb904a" >> "$root/VERSIONS"

cat "$root/VERSIONS"
ls -la "$jni" "$root/lib" "$root/lib/aarch64-linux-gnu"
