<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/mandarin-logo-light.png">
  <img width="800" alt="Mandarin by MusicD" src="docs/mandarin-logo-dark.png">
</picture>

</div>

# Mandarin — v0.6.22

**Your own music files, played to Sonos rooms, to UPnP/DLNA renderers (a WiiM, a Chord Poly,
a streamer, an AV receiver) and to the Mandarin Android app.**

**📖 Install guide & command builder: [meltface-80.github.io/Mandarin](https://meltface-80.github.io/Mandarin/)**

A server on a machine you own scans your music folders and plays them to the players in your
house. You control it from a browser, an iPhone home-screen app or the Android app. No
subscription or streaming account is needed. Album names are looked up online (MusicBrainz,
Wikipedia, Deezer and others); your music files stay on your machine.

```
 browser / iPhone PWA / Android app ──HTTP──▶  Mandarin  ──Sonos UPnP──▶  Sonos rooms
                                                   │      ──UPnP AV / DLNA──▶  WiiM, Chord Poly, receivers, TVs
                                                   │      ──HTTP──▶  the Android app (phone, USB DAC)
                                                   └──── audio: /stream/… ◀────────┘
```

---

## Features

<!-- features:start -->

Every feature below has an **ⓘ**: open it for how to switch the feature on and use it.

🏠 **Home**

Rows of albums under a greeting: Not played in 6 months, Listen later, Playlists, Favourites, Recently played, Smart Picks, Label of the week, Random albums, Library and Browse by genre.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **☰ → Home**. Tap a row's title for all of it. To reorder rows or hide one, open **Settings → Setup → Home Screen**, hold a row's grip and drag it, or switch it off.

</details>

⸻

🎲 **Random Album** — *new since v0.5.50*

The first tile under the greeting plays a random album you haven't played in 12 months; until Mandarin has 12 months of history, any album.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Choose where to play with the speaker button, then tap **Random Album**. Its disc turns while an album is found.

</details>

⸻

📅 **Album of the day** — *new since v0.5.50*

One album, the same on every device, chosen by the server at 00:01. Once played from any device, it's gone until the next 00:01.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Nothing to set up: it sits beside Random Album on Home. 00:01 is in the server's time zone (`TZ` in the Docker command).

</details>

⸻

⏳ **Not played in 6 months** — *new since v0.5.50*

Albums you haven't played in six months. The row stays hidden until Mandarin has six months of your listening.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

A Home row; tap its title for all of them. Move or hide it in **Settings → Setup → Home Screen**.

</details>

⸻

📚 **Library**

Every album, sorted by name, artist, release date, date added, plays, last played or random, and narrowed by genre, decade, label, format, sample rate, bit depth or first letter.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Tap the **Library** row's title on Home. **Sort** and **Focus** are in the top bar; Focus also has *Added in the last* and *Listening* (never played, not in 6 or 12 months). **☰ → Random albums** opens a shuffled wall.

</details>

⸻

🔍 **Search**

Albums, artists and labels as you type. Words can come in any order, accents and capitals are ignored, and a title with letters left out is still found.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Tap the magnifying glass in the top bar and type. Labels show when Record labels is on.

</details>

⸻

💿 **Album pages**

Tracks, year and label, write-ups from Wikipedia and Qobuz, and Pitchfork's score where it reviewed the album. Step to the previous or next album of the row you came from.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Tap any album. **Play Now** and **Queue** are on the page; **⋯** has Play Next, Shuffle, Radio, Listen later, Edit album and (in the Android app) Download. Swipe sideways, tap **‹ ›** or press ← → for the previous or next album.

</details>

⸻

✏️ **Edit album**

Correct an album's title, artist or year and choose its cover. Edits are kept in the server's database; your music files are not changed.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

On an album, tap **⋯ → Edit album**.

</details>

⸻

🗂️ **Music folders**

Any number of folders the server can see, added and removed in the app. Changes show by themselves where the file system reports them, otherwise at the next scan.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Music Folders** and add a folder from the list of drives and folders the server can see. A full scan runs every 6 hours (`SCAN_INTERVAL_HOURS`); **☰ → Rescan library** runs one now.

</details>

⸻

💽 **One album per folder** — *new since v0.5.50*

Each folder is one album. Disc folders inside it, such as Disc 1 or CD2, make one album shown disc by disc, with a two-disc symbol on its cover.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Nothing to set up.

</details>

⸻

📝 **Untagged files named from folders** — *new since v0.5.50*

A file with no tags takes its artist, album, year, title and track number from its folder and file names. Nothing is written to your files.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Nothing to set up. Those albums are then looked up by the Library Scanner like any other.

</details>

⸻

🏷️ **Every tag kept** — *new since v0.5.50*

All of each file's tags are read into the server's database, including MusicBrainz IDs, barcode, catalogue number, ISRC and ReplayGain, and used to identify albums.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Nothing to set up: tags are read with every scan.

</details>

⸻

🔎 **Library Scanner** — *new since v0.5.50*

Names albums from their files' identifiers first, then from MusicBrainz by tracks and lengths, with Apple's iTunes catalogue as a second source. Measures ReplayGain for files without it.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Library Scanner**. Matches of 95% or better are applied (with Undo); near ones wait for **Accept** or **Reject**. Your files are not changed. **Ask iTunes too** and **Measure ReplayGain** are on the same page.

</details>

⸻

📦 **MusicBrainz pack** — *new since v0.5.50*

An optional download of every MusicBrainz release with a barcode, about 2 GB on disk. Albums with a barcode are matched from it, also while musicbrainz.org is down.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Library Scanner → MusicBrainz pack** and tap **Download**. **Folder** chooses where it's kept; in Docker that folder needs a writable mount (see Install).

</details>

⸻

▶️ **Now playing**

Cover, track, transport, volume, the queue and history, and a badge saying what the device is being sent. An optional waveform seek bar is drawn from the audio.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Tap the bar at the bottom of the screen. The waveform is off until you switch on **Settings → Audio Devices → Waveform**. On a large screen, Now playing can shrink to a card you drag around.

</details>

⸻

↪️ **Move to another device** — *new since v0.5.50*

Pick another room, renderer or phone while music plays and it moves there: the queue goes with it, from the same track and second.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Tap the speaker button (on the bar or Now playing) and choose the device to move to.

</details>

⸻

📻 **Random Album Radio**

When a device's queue is running out, a random album you haven't played in 60 days goes on the end. Switched on per device.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Audio Devices**, tap the device and switch on **Random album radio**. **⋯ → Radio** on an album plays it and switches radio on for that device.

</details>

⸻

🔈 **Sonos**

Play, queue, play next, shuffle, repeat and volume for each Sonos room, and grouping and ungrouping rooms. Sonos plays up to 24-bit / 48 kHz; Mandarin converts anything above.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Sonos rooms are found on the network by themselves (`SONOS_HOSTS` if not). Pick one with the speaker button; **Group zones…** in the same list groups them.

</details>

⸻

📡 **UPnP/DLNA renderers**

WiiM, Chord Poly, streamers, AV receivers and TVs on your network, played like a Sonos room. Tracks join gaplessly on a renderer that supports it.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

A renderer found on the network is off until you switch it on in **Settings → Audio Devices**. Then pick it with the speaker button. **Look again** searches the network now.

</details>

⸻

🖥️ **Sound devices on the server** — *new since v0.5.50*

A USB DAC, speakers or HDMI on the computer Mandarin runs on, played like a Sonos room. Tracks at the same rate join with nothing between them.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Plug it in, then switch it on in **Settings → Audio Devices**. In Docker, add `--device /dev/snd` and `--privileged`. On a Mac, set its rate in Audio MIDI Setup. Details under [Sound devices on the server](#sound-devices-on-the-server).

</details>

⸻

🎚️ **Audio Devices**

Every room, renderer and phone with the rates, depths and formats it takes, your own name for it, and a switch. Renderers play Original or upsampled ×2, ×4 or Max.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Audio Devices** and tap a device. The name you give it is what the speaker list and Now playing show. **Output** is on a renderer's page.

</details>

⸻

💎 **DSD** — *new since v0.5.50*

A renderer that says it takes DSD files is sent the DSF or DFF itself; others get PCM. A USB DAC on the phone gets DSD natively or as DoP.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

On a renderer's page in **Settings → Audio Devices**, switch the DSD rates it takes on or off.

</details>

⸻

🔊 **Volume Levelling** — *new since v0.5.50*

ReplayGain per device: Off, Track, Album or Auto, a target from −14 to −25 LUFS, and a level for tracks with no loudness information.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Audio Devices**, tap the device, and set **Volume levelling** (above DSP). Auto plays albums at album level and mixed tracks at track level.

</details>

⸻

🎛️ **DSP**

A parametric EQ of up to ten bands per renderer or phone, its curve drawn as you edit, plus headphone profiles from AutoEq or a pasted ParametricEQ.txt.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Audio Devices**, tap a renderer or the phone, and switch on **DSP**. Sonos rooms have no DSP here.

</details>

⸻

⭐ **Smart Picks**

Five albums a day from your own library, by artists Deezer lists as related to the ones you've played, topped up from your least-played albums.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

**☰ → Smart Picks**, or its Home row. **Settings → Setup → Smart Picks** switches it on or off and sets the hour each day's picks are made.

</details>

⸻

🧭 **Discover**

New albums by the artists you play, looked up on Deezer. Off until you switch it on.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Switch it on in **Settings → Setup → Discover**, then open **☰ → Discover**.

</details>

⸻

📰 **Pitchfork**

Pitchfork's latest album reviews and Best New Music, read in the app, with Play on any album you own.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **☰ → Pitchfork**.

</details>

⸻

🏢 **Record labels**

Labels from your files' tags or a folder level: a Labels screen, logos from Discogs and FanArt.tv, lookups for albums without a label, and merging of duplicate names.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Switch it on in **Settings → Setup → Record labels**. Logos need a Discogs token or FanArt.tv key (**Settings → Setup → API Keys**). On **☰ → Labels**, search and #–Z are in the top bar; hold a tile to select labels to merge.

</details>

⸻

📆 **Label of the week**

With Record labels on, one label from your library on Home all week, with its albums. A new one each Monday.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Switch on **Settings → Setup → Record labels**; the row then shows on Home.

</details>

⸻

❤️ **Favourites**

A heart on every album. Hearted albums gather on a Home row.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Tap the heart on an album's page. Tap the **Favourites** row's title for all of them.

</details>

⸻

🕒 **Listen later**

Albums put aside to play another time, on a Home row and a screen of their own. Each comes off by itself once every track has been played.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

On an album, **⋯ → Listen later**, or select several on a wall. Open the list from **☰ → Listen later**.

</details>

⸻

🎵 **Playlists**

Playlists you make, and Dynamic Playlists that follow a saved Library view. A playlist can be shared as text and imported, matched against the other library's tracks.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

**☰ → Playlists**, **☰ → Dynamic Playlists** and **☰ → Import a playlist**. A playlist's **Share** gives the text to send.

</details>

⸻

🖼️ **Share card**

The album as a picture, with links to hear it and read about it on the services you choose, and three related artists suggested beside it.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Tap the share button on an album's page. Choose the services in **Settings → Setup → Share Card**. In the Android app, **Download** saves the card to Pictures/Mandarin.

</details>

⸻

📺 **Wall display**

A full-screen now playing page for a TV or tablet.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open `http://<server-ip>:3500/display` on the screen. Its options are in **Settings → Wall Display**.

</details>

⸻

📱 **The Android app**

The same interface, plus lock-screen and notification controls, volume keys, a widget, a Quick Settings tile, a share sheet, Android Auto, and updates of its own.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Download [mandarin-android.apk](https://github.com/meltface-80/Mandarin/raw/main/dist/mandarin-android.apk) and install it (Android 8.0 or newer). Enter the port; it finds the server on your Wi-Fi.

</details>

⸻

🎧 **This phone**

The phone is a player of its own: speaker, headphones or Bluetooth, with queue, history and radio. At home, your other devices can play to it while the app runs.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

In the Android app, pick **This phone** with the speaker button.

</details>

⸻

🔌 **USB DAC on the phone**

The app's own USB Audio driver plays to a DAC on the phone's port at the file's rate and depth, without Android's mixer; DSD natively or as DoP.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Plug the DAC in. It shows on **This phone**'s page in **Settings → Audio Devices**; switch on **USB direct** there.

</details>

⸻

⬇️ **Downloads**

Albums kept on the phone as the original files or Opus 256, played without the server. Smart Picks, the Album of the day and new albums can download by themselves.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

On an album, **⋯ → Download to this phone**. Quality, the download folder, Wi-Fi only and automatic downloads are in **Settings → Downloads** in the app.

</details>

⸻

📂 **Music on this phone**

A folder of music already on the phone, watched for changes, shown on Home and played like the library. The server never sees these files.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

In the app, **Settings → Music Folders → On this phone** and choose the folder.

</details>

⸻

✈️ **Offline mode** — *new since v0.5.50*

One switch: only the music on the phone shows, and the server isn't used. With no connection the app does the same by itself, and reconnects when it can.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

In the Android app, **☰ → Offline mode**.

</details>

⸻

🌍 **Away from home**

On mobile data the app reaches the server through its own Tailscale, with no ports opened. Away, only the phone plays: Opus 256 or the original files.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

**Settings → Setup → Away from home** on the server: **Sign in to Tailscale**. Then in the app, the same page: **This phone**. Open the app once at home. Details under [Away from home](#away-from-home-tailscale).

</details>

⸻

🎨 **UI Settings** — *new since v0.5.50*

Text sizes, grid layout (Auto, 3 or 2 columns, or List) and tile size, saved on each device. On a desktop, text goes up to +100%.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Setup → UI Settings** and pick from each list; it applies at once.

</details>

⸻

👤 **One account**

One username and password, kept on the server. Devices sign in with SRP, so the password itself is never sent, and every signed-in device is listed.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Create it on first visit from a device at home. **Settings → Account** lists devices, signs one out and changes the password. Forgotten: see [Your account](#your-account).

</details>

⸻

⏻ **Restart and shut down** — *new since v0.5.50*

Restart Mandarin, or shut it down so it stops finding and controlling your speakers until you start it again. In Docker, only Restart.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open the side menu (☰) and tap the **power button** in its top-right corner, then **Restart** or **Shut down**. On a Mac, double-click **Mandarin** on the desktop to start it again (installed before v0.6.12? Run the install line once more for the icon). In Docker: `docker stop musicd-server`, then `docker start musicd-server`.

</details>

⸻

💾 **Backup and restore** — *new since v0.5.50*

Back up settings, players, collection, API keys and the whole database, at home or away: to the server, or from the Android app to a file with its settings.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

Open **Settings → Backup & restore**, tick what to include, then **Back up to the server** (or, in the app, **Back up to a file on this phone**). To restore, pick a backup (or the file), tick the parts and tap **Restore**. Mandarin keeps a backup of how things were first, then restarts.

</details>

⸻

🔄 **Updates**

The server updates itself from GitHub from Settings and checks every 12 hours. The Android app offers each new version when it opens.

<details><summary><b>ⓘ</b> How to set it up and use it</summary>

**Settings → Updates → Check for updates**, then **Update to vX.Y.Z**. The server restarts itself in a few seconds.

</details>

<!-- features:end -->

## What each device is sent

Each track goes the way the device can take it. The Now playing badge says what was sent.

* **Sonos** plays up to 24-bit / 48 kHz. Within that, the file as stored. Above it, or in a
  format Sonos can't read, FLAC at 24/48.
* **A UPnP/DLNA renderer** has its own ceiling, read from the device. Within it, the file as
  stored; above it, FLAC at the highest rate the device takes in the file's family; upsampled
  ×2, ×4 or to the device's maximum if you choose. DSD goes as the DSF or DFF file itself to a
  device that says it takes DSD files (DSD rates switchable on its page), as PCM otherwise.
* **The Android app** on the phone's own output: the file as stored within 24/48, FLAC 24/48
  above it; away from home, Opus 256 by default.
* **A USB DAC on the phone**, with USB direct on: the file at its own rate and depth where the
  DAC takes it, DSD natively or as DoP, FLAC at the DAC's highest rate otherwise.
* **Formats nothing plays as they are** — APE, WavPack, WMA Lossless, 24-bit WAV, more than two
  channels — become FLAC, in stereo.

Conversion is ffmpeg with the SoX resampler and triangular dither. A converted track is written
to a cache as it plays, so the device starts on the first frames, and the next tracks in the
queue are prepared ahead. Replays come from the cache (4 GB by default, least recently played
removed first).

## Install (Docker)

Run it on an always-on Linux machine on the same network as your speakers — a NAS, a
Raspberry Pi 4/5 (64-bit OS), a home server.

If Docker isn't installed yet:

```bash
dietpi-software install 162              # DietPi (162 is its Docker package)
curl -fsSL https://get.docker.com | sh   # Debian, Ubuntu, Raspberry Pi OS
```

Then:

```bash
docker stop musicd-server 2>/dev/null; docker rm musicd-server 2>/dev/null
docker pull ghcr.io/meltface-80/musicd-server:latest

docker run -d \
  --name musicd-server \
  --network host \
  --restart unless-stopped \
  -e TZ=Europe/London \
  -v musicd-server-data:/app/data \
  -v /your/path/to/Music:/music:ro \
  -v /mnt:/mnt:ro,rslave \
  ghcr.io/meltface-80/musicd-server:latest
```

Open **`http://<server-ip>:3500`**. The first scan runs straight away; a big library takes a
few minutes and albums appear as it goes.

> **`--network host` is required.** Sonos players are found by multicast, which does not
> cross Docker's default bridge network — and the speakers fetch audio from this machine's
> own address. Docker Desktop on macOS/Windows has no real host networking, so this needs a
> Linux host. On a Mac, run it without Docker: see [Install on a Mac](#install-on-a-mac).

> **Keep the `musicd-server-data` volume.** It holds the library database, play history,
> playlists, settings and the artwork and transcode caches. Point every future `docker run`
> at the same name.

**The MusicBrainz pack on another drive (optional).** The pack (Settings → Library Scanner) is
2 GB, kept in the data volume unless you choose a folder. To keep it on another drive, add a
writable mount — no `:ro` — to the command above, e.g.:

```bash
  -v /mnt/dietpi_userdata/1tb/mandarin:/packs \
```

then choose `/packs` under **Folder** on that page. Keep the line in every future `docker run`
(an update included): without it `/packs` isn't there, and the page says so. A folder reached
through the read-only `-v /mnt:/mnt:ro,rslave` mount can't be used for the pack.

**A USB DAC or speakers on this machine (optional).** To play through sound devices plugged into
the machine Docker runs on, add these two lines to the command above:

```bash
  --device /dev/snd \
  --privileged \
```

`--device /dev/snd` hands the sound devices to the container; `--privileged` lets the container
open them, which on most hosts it otherwise can't (the device nodes belong to the host's `audio`
group). They then appear in **Settings → Audio Devices**. A container already running needs
re-creating with the lines (stop, rm, the `docker run` again — the data volume carries everything
over). See [Sound devices on the server](#sound-devices-on-the-server).

**Music folders, chosen in the app.** Mount your drives or shares into the
container once — e.g. `-v /mnt:/mnt:ro,rslave` — then add any folders inside them in
**Settings → Music Folders**, as many as you like, and remove them there too. The folder
picker lists every drive and share the server can see.

> **DietPi (and any network share mounted on demand):** DietPi-Drive_Manager mounts USB
> drives and network shares under `/mnt`, and mounts shares only when they're first opened.
> A container started with a plain `-v /mnt:/mnt:ro` never sees those later mounts — the
> folder looks empty. End the line with **`,rslave`** (`-v /mnt:/mnt:ro,rslave`) so mounts the
> machine makes afterwards reach the server too, then re-create the container. Music Folders
> says so when it spots a share it can't see. `/music` is
the first folder until you change the list. A folder that goes missing for a while (a drive
asleep, a share that dropped, part of it unreadable, most of it gone at once) keeps its
albums; the page says so and offers to forget it.

A `docker-compose.yml` is in the repository: set your music path and `docker compose up -d`.

### Build it yourself instead

```bash
git clone https://github.com/meltface-80/Mandarin.git
cd Mandarin
docker build -t musicd-server:local .
# then the docker run above, with musicd-server:local as the image
```

### Updating

**In the app:** Settings → **Updates** → **Check for updates** → **Update to vX.Y.Z**. The server
downloads the new release from GitHub, swaps it in and restarts itself in a few seconds;
the page reloads on its own. It also checks twice a day and shows a banner when a new
version is out. (From v0.1.3 on — an older container needs one update the manual way.)

**Manually** — also the way to pick up changes to the image itself (ffmpeg, Node):

```bash
docker pull ghcr.io/meltface-80/musicd-server:latest
docker stop musicd-server && docker rm musicd-server
# re-run the docker run command above — the data volume carries everything over
```

## Install on a Mac

Mandarin runs on a Mac without Docker: macOS 14 or newer, macOS 27 included, Apple silicon or
Intel. The Mac needs to stay on, on the same network as your speakers.

**1. Open Terminal**: press Command-Space, type **Terminal** and press Return.

**2. Paste this line** and press Return:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/meltface-80/Mandarin/main/tools/mac/install.sh)"
```

**3. Answer what it asks:**
* **Your Mac's password**, if it asks: type it and press Return. Nothing shows as you type; that's
  normal.
* **Your music folder**: a Finder window opens. Click the folder your music is in (on the Mac or on
  an external drive) and click **Choose**.
* **The MusicBrainz pack**: where to keep it, if you download it later (optional, about 2 GB).
  **On this Mac** is fine; **Choose a folder...** to put it on another drive.
* **Keep this Mac awake**: choose **Keep awake** so the music doesn't stop when the Mac would sleep.
* **Your Desktop folder**, if macOS asks: **Allow**, so the Mandarin icon can go on the desktop.
* **Allow** if macOS asks to let **node** find devices on your network or open your files.

**4. Done.** Mandarin opens in your browser: create your account. It starts by itself every time you
log in. On a phone, open the address Terminal shows at the end (`http://<mac-ip>:3500`). Add more
music folders, or change them, any time in **Settings → Music Folders**.

**Do you have Mandarin already running on another machine?** Yes, then this Mac doesn't need to
install anything, just open the server's IP address with port `:3500` in Safari and choose
**File → Add to Dock**. It opens like an app, for choosing music and playing it on your speakers.

**On a Mac:**
* **Updates** come from the app, as on Linux (Settings → **Updates**).
* **Shut down and start again:** the **power button** at the top right of the side menu (☰) →
  **Shut down** stops Mandarin; double-click
  **Mandarin** on the desktop (or in your Applications folder) to start it again. It also starts
  when you log in. Installed before v0.6.12? Paste the install line once more to get the icon.
* **Your data** (library, history, playlists, settings) is kept in `~/Mandarin/data`.
* **Away from home:** the built-in Tailscale is for Linux only. Install the Tailscale app on the
  Mac (Mac App Store) and sign in; Mandarin finds the Mac's Tailscale address by itself.
* **A USB DAC or the Mac's speakers:** they're in **Settings → Audio Devices**, off until you switch
  them on. See [Sound devices on the server](#sound-devices-on-the-server).
* **No albums?** macOS may be keeping Mandarin out of the folder. In System Settings → Privacy &
  Security → **Full Disk Access**, click **+**, press Command-Shift-G, paste
  `/opt/homebrew/opt/node@22/bin/node` (on an Intel Mac `/usr/local/opt/node@22/bin/node`),
  and click **Open**.
* **Rooms not found?** Run this in Terminal with one of your speakers' IP addresses, then restart
  the Mac: `/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:SONOS_HOSTS string 192.168.1.20" ~/Library/LaunchAgents/app.mandarin.server.plist`
* **Stop Mandarin starting at login:** `launchctl unload ~/Library/LaunchAgents/app.mandarin.server.plist`

<details>
<summary><b>Prefer to install by hand?</b></summary>

In **Terminal**:

1. Install [Homebrew](https://brew.sh) if you don't have it, then Node.js and ffmpeg:

   ```bash
   brew install node@22 ffmpeg
   echo 'export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"' >> ~/.zprofile
   source ~/.zprofile
   ```

2. Download Mandarin:

   ```bash
   git clone https://github.com/meltface-80/Mandarin.git ~/Mandarin
   cd ~/Mandarin
   npm ci --omit=dev
   ```

3. Start it with **your** music folder. Replace `$HOME/Music` with your own; to get its path
   without typing, type `MUSIC_DIR="`, drag the folder from Finder onto the Terminal window, then
   type `" npm start`. An external drive is under `/Volumes/…`.

   ```bash
   cd ~/Mandarin
   MUSIC_DIR="$HOME/Music" npm start
   ```

   Open **`http://localhost:3500`** and create your account.

4. **Keep the Mac awake:** System Settings → Energy (or Battery → Options) → **Prevent automatic
   sleeping when the display is off**.

5. **Start it at login (optional).** Stop it first (Control-C). In the file below, put the **same
   music folder** as in step 3 where it says `$HOME/Music`, then paste it:

   ```bash
   mkdir -p ~/Mandarin/data
   cat > ~/Library/LaunchAgents/app.mandarin.server.plist <<PLIST
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>app.mandarin.server</string>
     <key>ProgramArguments</key><array><string>$(which node)</string><string>$HOME/Mandarin/launcher.js</string></array>
     <key>WorkingDirectory</key><string>$HOME/Mandarin</string>
     <key>EnvironmentVariables</key><dict>
       <key>MUSIC_DIR</key><string>$HOME/Music</string>
       <key>PATH</key><string>$(brew --prefix)/bin:/usr/bin:/bin</string>
     </dict>
     <key>RunAtLoad</key><true/>
     <key>KeepAlive</key><true/>
     <key>StandardOutPath</key><string>$HOME/Mandarin/data/server.log</string>
     <key>StandardErrorPath</key><string>$HOME/Mandarin/data/server.log</string>
   </dict></plist>
   PLIST
   launchctl load ~/Library/LaunchAgents/app.mandarin.server.plist
   ```

**The MusicBrainz pack (optional, about 2 GB)** needs no setup on a Mac: in **Settings → Library
Scanner → Folder**, pick any folder, an external drive (**Volumes**) included. Unlike Docker,
there's no `/packs` mount to add. With no folder chosen it's kept in `~/Mandarin/data`.

</details>

## Configuration

Everything is optional; pass any of it with `-e NAME=value`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3500` | The web interface, the API, and where speakers fetch audio. |
| `TZ` | UTC | Your time zone — Album of the day changes over at 00:01 and Smart Picks at local midnight. |
| `SONOS_HOSTS` | — | A speaker's IP (comma-separated for several), for when multicast discovery is unreliable. One is enough. |
| `UPNP_HOSTS` | — | UPnP/DLNA renderers to ask by address (an IP, or a description URL like `http://192.168.1.50:49152/description.xml`), for when multicast discovery misses them. |
| `SERVER_IP` | auto | The address speakers should fetch audio from, for hosts with several network interfaces. |
| `INCLUDE_ZONES` | — | Offer only these rooms, e.g. `Kitchen,Study`. |
| `EXCLUDE_ZONES` | — | Offer every room except these. |
| `SCAN_INTERVAL_HOURS` | `6` | How often the music folders are re-checked in full (only changed files are re-read). Changes are also noticed as they happen through the file system's own notifications, where it gives them — a network share changed from another machine waits for this. Rescan any time from the menu. |
| `TRANSCODE_CACHE_GB` | `4` | Disk kept for converted tracks. An upsampled track is several times a CD-rate one: with upsampling on, 16 is a better number. |
| `TRANSCODE_CONCURRENCY` | `2` | How many tracks are converted at once. |
| `MUSIC_DIR` | `/music` | Where the library is mounted inside the container. |
| `TS_AUTHKEY` | — | Sign the server's built-in Tailscale in with an auth key instead of from *Settings → Setup → Away from home*. |
| `TS_HOSTNAME` | `musicd` | The server's name on your tailnet. |
| `TAILSCALE` | on | `off` leaves the built-in Tailscale out (Tailscale on the host still works). |
| `LOCAL_AUDIO` | on | `0`: leave this computer's sound devices out of *Settings → Audio Devices*. See [Sound devices on the server](#sound-devices-on-the-server). |
| `TAILSCALE_ADDRESS` | auto | The server's address away from home, if the one found on the host's `tailscale0` isn't the one to use — an IP, a MagicDNS name, or a full `https://` address. See [Away from home](#away-from-home-tailscale). |
| `MUSICBRAINZ_URL` | musicbrainz.org | Another MusicBrainz web service (a mirror) for the identification scan and release days. |
| `IDENTIFY` | on | `0` leaves the identification scan out entirely. |
| `MBPACK_DIR` | data folder | Where the MusicBrainz pack is kept (Settings → Library Scanner); overrides the folder chosen there. |
| `ITUNES_COUNTRY` | US | The Apple store the identification scan's iTunes lookups use (`GB`, `DE`…). |
| `AUTOEQ_URL` | GitHub | Where AutoEq's results are read from for headphone profiles (Settings → Audio Devices → a device → DSP). |
| `DEBUG` | — | Log every API call. |

Settings for the FanArt.tv key (wall-display artist photos), waveform, share-card services, Smart Picks, Discover,
the wall display and the Home rows are in the app's Settings and are saved in the data volume.

## Your account

Mandarin has **one account**, kept on the server itself — nothing online. Until it
exists the server does nothing but ask for it:

1. Open `http://<server-ip>:3500` on a device **on your home network** (a browser, the iPhone
   home-screen app, or the Android app) and choose a username and password.
2. Every other device signs in with them once and is remembered.
3. **Settings → Account** lists every signed-in device, with a *Sign out* button for each, and
   changes the password.

The password never crosses the network, even on plain http: devices prove they know it with
SRP (the scheme Apple uses for HomeKit pairing), and the server proves it knows the account
back. The server stores only an SRP verifier, never the password.

**Forgot the password?** On the server run

```bash
docker exec musicd-server node reset-password.js
```

It removes the account and signs every device out; your library, edits, playlists and history
stay. Then create the account again from a device at home.

Sonos speakers can't sign in: the addresses they're given carry a signature, and the speakers'
own addresses are let through, so playback is unaffected.

## iPhone and iPad

Open `http://<server-ip>:3500` in Safari, tap **Share → Add to Home Screen**. It opens full
screen like an app, with the same interface as the Android app.

## Android

The app is in **[android/](android/)**. Enter the port (3500 unless you changed it) and it finds
the server on your Wi-Fi, or type the address; then sign in, or create the account on a new
server, in the app. Its features are listed under [Features](#features).

**Download: [mandarin-android.apk](https://github.com/meltface-80/Mandarin/raw/main/dist/mandarin-android.apk)**
— the newest build, published by GitHub Actions on every version merged to `main`. Sideload it
on Android 8.0 or newer.

**Updates install over the top.** From v0.6.10 the published app is a release build signed with
the project's own private key, and every update after it installs in place.

**Coming from a build before v0.6.10?** Those were signed with a different, shared key, so
Android refuses the update ("conflicts with an existing package"). Uninstall the app once,
install [mandarin-android.apk](https://github.com/meltface-80/Mandarin/raw/main/dist/mandarin-android.apk),
open it, enter the server's address and sign in again. Albums downloaded to the phone go with
the uninstall, so download them again. After that, never again.

**Building the app yourself?** Without the `MUSICD_KEYSTORE_BASE64` and
`MUSICD_KEYSTORE_PASSWORD` secrets, a build is signed with the shared key committed here
(`android/app/musicd-debug.keystore`) and named `…-shared-key.apk`. It can't update the
published app, nor the published app it.

## Sound devices on the server

A USB DAC, the speakers or HDMI on the computer Mandarin runs on can be played to like a Sonos
room (v0.6.18).

1. Plug the DAC in. Within 30 seconds (or after **Look again**) it is listed in
   *Settings → Audio Devices*, off. Switch it on; it is then in the speaker list.
2. On its page: the rates it takes (a USB DAC on Linux lists its own; tap to change), **Output**
   (Original, ×2, ×4, Max), **Fixed volume**, **Volume levelling** and **DSP**, as for a renderer.

How it plays: ffmpeg decodes each track and a second ffmpeg holds the device open. The next track
at the same rate goes into the open device with nothing between them; a track at another rate
reopens it. Mandarin's slider scales the samples on a curve of 50 dB (100% leaves them untouched);
with **Fixed volume** on they are never scaled and the volume is the DAC's or amplifier's.

* **Linux:** ALSA, opened as `plughw:CARD=<name>,DEV=<n>`, so a DAC on another USB port is the
  same device. ALSA converts the 32-bit samples to the depth the device takes. While a track
  plays, ALSA's own report of the rate is compared with what was sent; a match is marked ✓.
  The user Mandarin runs as must be in the `audio` group. A device another program (PipeWire,
  PulseAudio) holds is reported as in use.
* **Docker:** add `--device /dev/snd` and `--privileged` to `docker run` (in `docker-compose.yml`,
  the commented `devices:` and `privileged:` lines), then re-create the container.
* **Mac:** Core Audio, through ffmpeg's `audiotoolbox` output (Homebrew's ffmpeg has it). The Mac
  plays at the rate set for the device in **Audio MIDI Setup** (Applications → Utilities) and
  converts anything else, so set it there. Mandarin sends at that rate, or 44.1 or 48 kHz, unless
  you tick others on the device's page.
* DSD files go to these devices as PCM.

From [Music Assistant](https://github.com/music-assistant)'s Local Audio Out: the volume curve, ids
taken from the device's name, and a device that fails being reported and let go.

## Away from home (Tailscale)

Leave the house and the Android app keeps working over mobile data: the phone is
the only thing it plays to. No ports are opened on your router — the phone reaches the server
over [Tailscale](https://tailscale.com), a private network between your own devices.

**Away, only the phone plays.** Whatever reaches the server from outside your home network —
Tailscale included — is offered one room: the phone asking, as *This phone*. The Sonos rooms
aren't listed, and nothing away can play to them, pause, group or mute them, or reach another
phone. The server decides this by where each request comes from, so it holds for any device:
an iPhone or a laptop on Tailscale can browse the library but has nothing to play to. At home
everything is as before. Away, tracks stream as **Opus 256 kbps** by default (about a quarter
of a CD-quality FLAC's data), made through a 64-bit float resample to Opus's 48 kHz and decoded
on the phone by the app's own libopus; *Settings → Downloads → Stream as* in the app can send
the original files instead. Albums you've downloaded play from the phone.

**Set up once — Tailscale is built in:**

1. On the server, open *Settings → Setup → Away from home* and tap **Sign in to Tailscale**. Sign in on
   Tailscale's page (a free account is enough). The server joins your tailnet by itself as
   **musicd** — no Tailscale to install on the machine it runs on, no VPN, no ports opened. For a
   server with no one at it, pass an auth key instead: `-e TS_AUTHKEY=tskey-auth-…`.
2. On the phone, sign Mandarin's app in to the same account: *Settings → Setup → Away from home → This phone*. The
   app carries its own Tailscale too — no Tailscale app needed.
3. Open Mandarin once at home: the app learns the server's tailnet address.

From then on the app follows the phone's network: on your Wi-Fi it uses the server's home
address; on mobile data (or anyone else's Wi-Fi) it goes over its own Tailscale connection, and
the page, the queue and the music carry on without a reload. Anything else signed in to your
tailnet — an iPhone with the Tailscale app, a laptop — opens the address *Away from home* shows.

The server's Tailscale keeps its identity in the data volume, so a new container is the same
machine. `TAILSCALE=off` leaves it out; `TS_HOSTNAME` names it something other than *musicd*.
Tailscale installed on the host still works as before (the server uses its own first when both
are there, or `TAILSCALE_ADDRESS` to say which).

Don't advertise your home subnet from the server's Tailscale (`--advertise-routes`): requests
through a subnet router arrive from a home address, and the server can't tell they're away.

## How it works

* **Library.** The music folder is walked and every audio file's tags are read with
  music-metadata into SQLite. Albums are decided a folder at a time, so a folder of tracks by
  different artists with no album-artist tag becomes one compilation, and `CD1`/`CD2` folders
  become one album. Covers come from `cover.jpg`/`folder.jpg`/… or the first track's embedded
  picture, resized once per size and cached. Rescans only re-read files whose size or date changed.
* **Renderers.** `lib/renderers/` finds UPnP/DLNA renderers by SSDP, reads each one's
  description and what it advertises it can play (plus a WiiM's own API), keeps a register
  of every device with your names and settings, and plays to them through AVTransport —
  the queue kept on the server, the next track handed over ahead of time (gapless on a
  renderer that supports it), changes arriving by UPnP events. `plan(track, target)` in `lib/stream.js` decides
  what each device gets: the file itself within its ceiling, FLAC at its highest rate or
  upsampled in 64-bit float otherwise.
* **Sonos.** Ported from [Caldera Sonos Bridge](https://github.com/meltface-80/Caldera-Sonos-Bridge)
  and the [UPnP to Sonos bridge](https://github.com/meltface-80/UPnP-to-Sonos-UPnP-bridge): one
  speaker is found over SSDP and the whole household is read from `ZoneGroupTopology`. A Sonos
  *group* is a zone (its coordinator owns the queue) and each *room* is an output (volume and
  mute are per room). Tracks go into the coordinator's own **Sonos queue**, with the DIDL-Lite
  metadata Sonos insists on, so the speaker moves between tracks by itself. The queue you see is read back from the speaker, so anything added from the Sonos
  app appears too.
* **Audio.** Each queued item is a URL on this server. Within 24/48 it serves the file as
  stored, with byte ranges; above that, ffmpeg writes FLAC 24/48 to the cache and the speaker
  is served from the growing file.
* **Interface.** Mandarin's own page in `public/`, served by the server and shown in the browser,
  the iPhone home-screen app and the Android app alike, talking to the server's `/api`.

## Troubleshooting

* **No rooms.** `http://<server>:3500/api/status` shows what discovery found (`sonos.rooms`,
  `sonos.error`). Check host networking, or set `SONOS_HOSTS` to one speaker's IP.
* **A room plays nothing / skips every track.** The speakers must be able to reach the server
  on its port. On a host with several interfaces set `SERVER_IP` to the LAN address.
* **No albums.** `/api/status` shows `music_dir` and `index_count`. Check the `/music` mount
  and that the container can read it.
* **Hi-res tracks don't play.** `http://<server>:3500/api/health` must say `"ffmpeg": true`.

## Development

```bash
npm install
npm test            # unit tests + end-to-end runs against a fake Sonos household and fake UPnP renderers
MUSIC_DIR=~/Music PORT=3500 node index.js
```

The end-to-end test starts two fake Sonos rooms on 127.0.0.11/12:1400, plays a CD-quality
album and a 24/96 album through the real server, and checks what the "speaker" fetched:
bit-perfect FLAC for the first, FLAC 24/48 for the second. It needs ffmpeg on the PATH
(or `FFMPEG_PATH`).

The browser test opens the page itself in headless Chromium or Chrome — at a desktop with a
mouse, a phone and a tablet — and checks Home, the album view and Now playing. It uses the
browser already installed (or `CHROME_PATH`), with no extra packages, and is skipped where
there is none.

## License

MIT. The Sonos control is ported from Caldera Sonos Bridge and the UPnP to Sonos bridge, by the
same author.
