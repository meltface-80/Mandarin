# MusicD Server — your own music files, played to Sonos.
#
# Three stages: MusicD's own Tailscale engine (Go, the same program as the
# Android app's) is built for the image's platform; Mandarin's server (C#,
# server/) likewise; and the image that runs carries only ffmpeg, poppler,
# the two programs and the page (public/). No Node.js since v0.9.0. No audio
# engine since item 324: the server plays no sound device of its own on
# Linux; a USB DAC beside it is Mandarin Bridge for Linux's.
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

# Debian trixie (13): its ffmpeg is 7.1, which writes 32-bit FLAC — a DAC that
# takes 32 bits (an SMSL SU-1 on a Mandarin Bridge renderer) is sent it; bookworm's
# 5.1 (and 6.1, which quietly caps the encoder at 24) could not, so 32-bit was
# refused and converted tracks went out at 24. The AOT programs need glibc 2.34
# or later: trixie's is 2.41.
FROM mirror.gcr.io/library/debian:trixie-slim
LABEL org.opencontainers.image.title="MusicD Server" \
      org.opencontainers.image.description="Your own music files, played to Sonos, with MusicD Remote's interface" \
      org.opencontainers.image.source="https://github.com/meltface-80/Mandarin" \
      org.opencontainers.image.licenses="MIT"

# ffmpeg converts anything above 24-bit/48 kHz (and formats Sonos cannot
# read) to FLAC 24/48, and makes what streamers and DACs are sent, 32-bit
# where they take it. Debian's build includes libsoxr, the better resampler.
# tini reaps ffmpeg children and passes SIGTERM on, so a stop is immediate.
# libicu: the C# server sorts names as the Node server did (server/).
# taskset and ionice (util-linux, in the base image): playback's own cores and
# the background work's priority (server/Mandarin.Server/Cpu.cs); checked here,
# so the image is never built without them.
# poppler-utils (v0.8.33): pdfinfo and pdftoppm, which draw the pages of an
# album's booklet for the album page (server/Mandarin.Server/Booklets.cs).
# python3 and python3-numpy (item 288): SQ-tool, at /sq-tool/ (sq-tool/, SqTool.cs);
# it reads FLAC with the image's ffmpeg, and records nothing itself (item 290: Mandarin
# records the zone and hands it the recording).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates libicu76 poppler-utils \
       python3 python3-numpy \
    && rm -rf /var/lib/apt/lists/* \
    && taskset --version && ionice --version && nice --version \
    && pdftoppm -v && pdfinfo -v \
    && python3 -c "import numpy" \
    && ffmpeg -version | head -1 && ffmpeg -hide_banner -buildconf | grep -q -- --enable-libsoxr

# Tailscale built in: signed in once from Settings → Away from home (or with
# TS_AUTHKEY), the server is on your tailnet by itself (server/Mandarin.Server/Admin/Tailscale.cs).
COPY --from=tsnet /out/musicdnet /usr/local/bin/musicdnet

WORKDIR /app
# Mandarin's server in C# (server/), and the page it serves.
COPY --from=server /out/mandarin-server /app/server/bin/mandarin-server
COPY package.json ./
COPY public ./public
# SQ-tool (items 288, 290): its code, started by the server at /sq-tool/.
COPY sq-tool/sqtool ./sq-tool/sqtool

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
