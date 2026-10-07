# MusicD Server — your own music files, played to Sonos.
#
# Four stages: MusicD's own Tailscale engine (Go, the same program as the
# Android app's) is built for the image's platform; Mandarin's audio engine
# (C#, engine/) likewise; native modules (better-sqlite3, sharp) are
# installed where a compiler is available in case a platform has no prebuilt
# binary; and the image that runs carries only Node, ffmpeg, the two engines
# and the app.
FROM --platform=$BUILDPLATFORM golang:1.26-bookworm AS tsnet
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

FROM node:22-bookworm-slim AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.title="MusicD Server" \
      org.opencontainers.image.description="Your own music files, played to Sonos, with MusicD Remote's interface" \
      org.opencontainers.image.source="https://github.com/meltface-80/Mandarin" \
      org.opencontainers.image.licenses="MIT"

# ffmpeg converts anything above 24-bit/48 kHz (and formats Sonos cannot
# read) to FLAC 24/48. Debian's build includes libsoxr, the better resampler.
# tini reaps ffmpeg children and passes SIGTERM on, so a stop is immediate.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tailscale built in: signed in once from Settings → Away from home (or with
# TS_AUTHKEY), the server is on your tailnet by itself (lib/server/tsnode.js).
COPY --from=tsnet /out/musicdnet /usr/local/bin/musicdnet

WORKDIR /app
# Mandarin's audio engine: sound devices on this computer (lib/local/engine.js).
COPY --from=audio /out/mandarin-audio /app/engine/bin/mandarin-audio
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json index.js launcher.js reset-password.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    DOCKER=1 \
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

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3500)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# launcher.js runs the server and, when Settings → Check for updates installs
# a new release, swaps the files in while the server is stopped and starts it
# again — the container keeps running throughout.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "launcher.js"]
