# MusicD Server — your own music files, played to Sonos.
#
# Four stages: MusicD's own Tailscale engine (Go, the same program as the
# Android app's) is built for the image's platform; Mandarin's audio engine
# (C#, engine/) likewise; Mandarin's server (C#, server/) likewise; and the
# image that runs carries only ffmpeg, poppler, PulseAudio (for Spotify
# Soloist's sound), the three programs and the page (public/). No Node.js
# since v0.9.0. Debian 13 from bug list item 142: Spotify Soloist needs glibc
# 2.38 or later, which Debian 12 hasn't.
# Docker Hub's official images are pulled through Google's mirror of them
# (mirror.gcr.io/library/…, v0.8.26): the same images, without Docker Hub's
# limit on anonymous pulls, which GitHub's shared runners kept hitting
# ("429 Too Many Requests"). Microsoft's own images come from Microsoft.
FROM --platform=$BUILDPLATFORM mirror.gcr.io/library/golang:1.26-bookworm AS tsnet
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY android/musicdnet/go.mod android/musicdnet/go.sum ./
RUN go mod download
COPY android/musicdnet/*.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags "-s -w -X main.version=server" -o /out/musicdnet .

# Mandarin's audio engine (v0.8.0): one native program, no .NET in the image.
# Built ahead of time (Native AOT) for the builder's own platform; for the
# other one (arm64, built on an amd64 runner) as one self-contained file,
# which needs no cross toolchain and runs the same. Either needs glibc 2.34
# at most, which the image's Debian has.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-noble-aot AS audio
ARG TARGETARCH
ARG BUILDARCH
WORKDIR /src
COPY package.json ./
COPY engine/Mandarin.Audio/*.csproj engine/Mandarin.Audio/*.cs ./engine/
RUN set -e; cd engine; \
    V=$(grep -m1 '"version"' ../package.json | cut -d'"' -f4); \
    RID=linux-$([ "${TARGETARCH:-amd64}" = arm64 ] && echo arm64 || echo x64); \
    if [ "${TARGETARCH:-amd64}" = "${BUILDARCH:-amd64}" ]; then \
      dotnet publish -c Release -r $RID -p:Version=$V -o /out --nologo; \
    else \
      dotnet publish -c Release -r $RID -p:Version=$V -p:PublishAot=false -p:SelfContained=true \
        -p:PublishSingleFile=true -p:PublishTrimmed=true -p:EnableCompressionInSingleFile=true -o /out --nologo; \
    fi; \
    rm -f /out/*.dbg /out/*.pdb; ls -la /out

# Mandarin's server in C# (v0.8.1; the whole server since v0.9.0). One
# self-contained file: no .NET in the image.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-noble-aot AS server
ARG TARGETARCH
WORKDIR /src
COPY package.json ./
# The whole project, its folders with it (bin/ and obj/ left out by
# .dockerignore), so a new folder can't be left behind (v0.8.37).
COPY server/Mandarin.Server/ ./server/
RUN set -e; cd server; \
    V=$(grep -m1 '"version"' ../package.json | cut -d'"' -f4); \
    RID=linux-$([ "${TARGETARCH:-amd64}" = arm64 ] && echo arm64 || echo x64); \
    dotnet publish -c Release -r $RID -p:Version=$V -p:SelfContained=true -p:PublishSingleFile=true \
      -p:EnableCompressionInSingleFile=true -o /out --nologo; \
    rm -f /out/*.pdb /out/*.dbg; ls -la /out

FROM mirror.gcr.io/library/debian:trixie-slim
LABEL org.opencontainers.image.title="MusicD Server" \
      org.opencontainers.image.description="Your own music files, played to Sonos, with MusicD Remote's interface" \
      org.opencontainers.image.source="https://github.com/meltface-80/Mandarin" \
      org.opencontainers.image.licenses="MIT"

# ffmpeg converts anything above 24-bit/48 kHz (and formats Sonos cannot
# read) to FLAC 24/48. Debian's build includes libsoxr, the better resampler.
# tini reaps ffmpeg children and passes SIGTERM on, so a stop is immediate.
# libicu: the C# server sorts names as the Node server did (server/).
# taskset and ionice (util-linux, in the base image): playback's own cores and
# the background work's priority (server/Mandarin.Server/Cpu.cs); checked here,
# so the image is never built without them.
# poppler-utils (v0.8.33): pdfinfo and pdftoppm, which draw the pages of an
# album's booklet for the album page (server/Mandarin.Server/Booklets.cs).
# pulseaudio and libatomic1 (item 142): Spotify Soloist, which Mandarin
# downloads from Spotify on request (it may not be redistributed), needs
# libatomic and plays only to PulseAudio: Mandarin starts a private one for it
# with no sound card, only a pipe it reads (server/Mandarin.Server/Spotify/).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates libicu76 poppler-utils pulseaudio libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && taskset --version && ionice --version && nice --version \
    && pdftoppm -v && pdfinfo -v && pulseaudio --version

# Tailscale built in: signed in once from Settings → Away from home (or with
# TS_AUTHKEY), the server is on your tailnet by itself (server/Mandarin.Server/Admin/Tailscale.cs).
COPY --from=tsnet /out/musicdnet /usr/local/bin/musicdnet

WORKDIR /app
# Mandarin's audio engine: sound devices on this computer (server/Mandarin.Server/Local/AudioEngine.cs).
COPY --from=audio /out/mandarin-audio /app/engine/bin/mandarin-audio
# Mandarin's server in C# (server/), and the page it serves.
COPY --from=server /out/mandarin-server /app/server/bin/mandarin-server
COPY package.json ./
COPY public ./public

ENV DOCKER=1 \
    PORT=3500 \
    MUSIC_DIR=/music \
    DATA_DIR=/app/data

# The data volume holds the library database, play history, settings, the
# artwork cache and the transcode cache. Keep it across upgrades.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Informational: host networking is required (SSDP to find the speakers, and
# the speakers must reach this port to fetch audio).
EXPOSE 3500

# The C# server asks itself (v0.8.50): one GET of /api/health on PORT, 0 when it answers 200.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
    CMD ["/app/server/bin/mandarin-server", "--health"]

# The C# server takes the port. When Settings → Check for updates installs a
# new release, it puts the new program and page in place and starts again in
# the same process — the container keeps running throughout.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/server/bin/mandarin-server"]
