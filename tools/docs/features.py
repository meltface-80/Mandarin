#!/usr/bin/env python3
"""
features.py: the one list of Mandarin's features, for the README and the site.

Each feature: what it is (30 words at most, shown) and how to switch it on and
use it (behind the ⓘ). Every line here is checked against the code; keep it so.

    python3 tools/docs/features.py      # rewrites both, between their markers
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# (id, emoji, title, new since v0.5.50, what it is, how to set it up and use it)
FEATURES = [
    # ---- Home and finding music
    ("home", "🏠", "Home", False,
     "Rows of albums under a greeting: Not played in 6 months, Listen later, Playlists, Favourites, "
     "Recently played, Smart Picks, Label of the week, Random albums, Library and Browse by genre.",
     "Open **☰ → Home**. Tap a row's title for all of it. To reorder rows or hide one, open "
     "**Settings → Setup → Home Screen**, hold a row's grip and drag it, or switch it off."),
    ("random-album", "🎲", "Random Album", True,
     "The first tile under the greeting plays a random album you haven't played in 12 months; until "
     "Mandarin has 12 months of history, any album.",
     "Choose where to play with the speaker button, then tap **Random Album**. Its disc turns while "
     "an album is found."),
    ("aotd", "📅", "Album of the day", True,
     "One album, the same on every device, chosen by the server at 00:01. Once played from any "
     "device, it's gone until the next 00:01.",
     "Nothing to set up: it sits beside Random Album on Home. 00:01 is in the server's time zone "
     "(`TZ` in the Docker command)."),
    ("unplayed", "⏳", "Not played in 6 months", True,
     "Albums you haven't played in six months. The row stays hidden until Mandarin has six months of "
     "your listening.",
     "A Home row; tap its title for all of them. Move or hide it in **Settings → Setup → Home Screen**."),
    ("library", "📚", "Library", False,
     "Every album, sorted by name, artist, release date, date added, plays, last played or random, "
     "and narrowed by genre, decade, label, format, sample rate, bit depth or first letter.",
     "Tap the **Library** row's title on Home. **Sort** and **Focus** are in the top bar; Focus also "
     "has *Added in the last* and *Listening* (never played, not in 6 or 12 months). "
     "**☰ → Random albums** opens a shuffled wall."),
    ("search", "🔍", "Search", False,
     "Albums, artists and labels as you type, and Qobuz's and Tidal's catalogues beside them: an "
     "album from either opens and plays whether or not it is in your library.",
     "Tap the magnifying glass in the top bar and type. Labels show when Record labels is on. Signed in "
     "to Qobuz or Tidal (Settings → Services), the service's artists and albums follow the library's; "
     "tap a cover for the album's page, an artist for their albums."),
    ("album", "💿", "Album pages", False,
     "Tracks, year and label, write-ups from Wikipedia and Qobuz, and Pitchfork's score where it "
     "reviewed the album. Step to the previous or next album of the row you came from.",
     "Tap any album. **Play Now** and **Queue** are on the page; **⋯** has Play Next, Shuffle, Radio, "
     "Listen later, Edit album and (in the Android app) Download. Swipe sideways, tap **‹ ›** or "
     "press ← → for the previous or next album."),
    ("edit", "✏️", "Edit album", False,
     "Correct an album's title, artist or year and choose its cover. Edits are kept in the server's "
     "database; your music files are not changed.",
     "On an album, tap **⋯ → Edit album**."),
    # ---- The library behind it
    ("folders", "🗂️", "Music folders", False,
     "Any number of folders the server can see, added and removed in the app. Changes show by "
     "themselves where the file system reports them, otherwise at the next scan.",
     "Open **Settings → Music Folders** and add a folder from the list of drives and folders the "
     "server can see. A full scan runs every 6 hours (`SCAN_INTERVAL_HOURS`); "
     "**☰ → Rescan library** runs one now, then brings Qobuz and Tidal up to date, in that order, "
     "where you are signed in with the import on."),
    ("folder-albums", "💽", "One album per folder", True,
     "Each folder is one album. Disc folders inside it, such as Disc 1 or CD2, make one album shown "
     "disc by disc, with a two-disc symbol on its cover.",
     "Nothing to set up."),
    ("untagged", "📝", "Untagged files named from folders", True,
     "A file with no tags takes its artist, album, year, title and track number from its folder and "
     "file names. Nothing is written to your files.",
     "Nothing to set up. Those albums are then looked up by the Library Scanner like any other."),
    ("tags", "🏷️", "Every tag kept", True,
     "All of each file's tags are read into the server's database, including MusicBrainz IDs, "
     "barcode, catalogue number, ISRC and ReplayGain, and used to identify albums.",
     "Nothing to set up: tags are read with every scan."),
    ("scanner", "🔎", "Library Scanner", True,
     "Names albums from their files' identifiers first, then from MusicBrainz by tracks and lengths, "
     "with Apple's iTunes catalogue as a second source. Measures ReplayGain for files without it.",
     "Open **Settings → Library Scanner**. **Clean up** there removes albums whose files are gone, after showing counts. Matches of 95% or better are applied (with Undo); near "
     "ones wait for **Accept** or **Reject**. Your files are not changed. **Ask iTunes too** and "
     "**Measure ReplayGain** are on the same page."),
    ("mbpack", "📦", "MusicBrainz pack", True,
     "An optional download of every MusicBrainz release with a barcode, about 2 GB on disk. Albums "
     "with a barcode are matched from it, also while musicbrainz.org is down.",
     "Open **Settings → Library Scanner → MusicBrainz pack** and tap **Download**. **Folder** "
     "chooses where it's kept; in Docker that folder needs a writable mount (see Install)."),
    # ---- Playing
    ("nowplaying", "▶️", "Now playing", False,
     "Cover, track, transport, volume, the queue and history, and a badge saying what the device is "
     "being sent. An optional waveform seek bar is drawn from the audio.",
     "Tap the bar at the bottom of the screen. The waveform is off until you switch on "
     "**Settings → Audio Devices → Waveform**. On a large screen, Now playing can shrink to a card "
     "you drag around. On the Queue tab, hold a track to select it and more; **⋯** plays the selection "
     "now or next, or removes it; **Clear all** empties the queue."),
    ("move", "↪️", "Move to another device", True,
     "Pick another room, renderer or phone while music plays and it moves there: the queue goes "
     "with it, from the same track and second.",
     "Tap the speaker button (on the bar or Now playing) and choose the device to move to."),
    ("radio", "📻", "Random Album Radio", False,
     "When a device's queue is running out, a random album you haven't played in 60 days goes on the "
     "end. Switched on per device.",
     "Open **Settings → Audio Devices**, tap the device and switch on **Random album radio**. "
     "**⋯ → Radio** on an album plays it and switches radio on for that device."),
    ("sonos", "🔈", "Sonos", False,
     "Play, queue, play next, shuffle, repeat and volume for each Sonos room, and grouping and "
     "ungrouping rooms. Sonos plays up to 24-bit / 48 kHz; Mandarin converts anything above.",
     "Sonos rooms are found on the network by themselves (`SONOS_HOSTS` if not). Pick one with the "
     "speaker button; **Group zones…** in the same list groups them."),
    ("upnp", "📡", "UPnP/DLNA renderers", False,
     "WiiM, Chord Poly, streamers, AV receivers and TVs on your network, played like a Sonos room. "
     "Tracks join gaplessly on a renderer that supports it.",
     "A renderer found on the network is off until you switch it on in **Settings → Audio Devices**. "
     "Then pick it with the speaker button. **Look again** searches the network now."),
    ("localout", "🖥️", "Sound devices on the server", True,
     "A USB DAC, speakers or HDMI on the computer Mandarin runs on, played like a Sonos room. "
     "Tracks at the same rate join with nothing between them.",
     "Plug it in, then switch it on in **Settings → Audio Devices**. In Docker, add `--device /dev/snd`. "
     "On a Mac, set its rate in Audio MIDI Setup. Details under [Sound devices on the server](#sound-devices-on-the-server)."),
    ("devices", "🎚️", "Audio Devices", False,
     "Every room, renderer and phone with the rates, depths and formats it takes, your own name "
     "for it, and a switch. Renderers play Original or upsampled ×2, ×4 or Max.",
     "Open **Settings → Audio Devices** and tap a device. The name you give it is what the speaker "
     "list and Now playing show. **Output** is on a renderer's page."),
    ("dsd", "💎", "DSD", True,
     "A renderer that says it takes DSD files is sent the DSF or DFF itself; others get PCM. A USB "
     "DAC on the phone gets DSD natively or as DoP.",
     "On a renderer's page in **Settings → Audio Devices**, switch the DSD rates it takes on or off."),
    ("levelling", "🔊", "Volume Levelling", True,
     "ReplayGain per device: Off, Track, Album or Auto, a target from −14 to −25 LUFS, and a level "
     "for tracks with no loudness information.",
     "Open **Settings → Audio Devices**, tap the device, and set **Volume levelling** (above DSP). "
     "Auto plays albums at album level and mixed tracks at track level."),
    ("dsp", "🎛️", "DSP", False,
     "A parametric EQ of up to ten bands per renderer or phone, its curve drawn as you edit, plus "
     "headphone profiles from AutoEq or a pasted ParametricEQ.txt.",
     "Open **Settings → Audio Devices**, tap a renderer or the phone, and switch on **DSP**. Sonos "
     "rooms have no DSP here."),
    # ---- Discovering
    ("picks", "⭐", "Smart Picks", False,
     "Five albums a day from your own library, by artists Deezer lists as related to the ones you've "
     "played, topped up from your least-played albums.",
     "**☰ → Smart Picks**, or its Home row. **Settings → Setup → Smart Picks** switches it on or off and sets "
     "the hour each day's picks are made."),
    ("pitchfork", "📰", "Pitchfork", False,
     "Pitchfork's latest album reviews and Best New Music, read in the app, with Play on any album "
     "you own.",
     "Open **☰ → Pitchfork**."),
    ("labels", "🏢", "Record labels", False,
     "Labels from your files' tags or a folder level: a Labels screen, logos from Discogs and "
     "FanArt.tv, lookups for albums without a label, and merging of duplicate names.",
     "Switch it on in **Settings → Setup → Record labels**. Logos need a Discogs token or FanArt.tv key "
     "(**Settings → Setup → API Keys**). On **☰ → Labels**, search and #–Z are in the top bar; hold a tile "
     "to select labels to merge."),
    ("lotw", "📆", "Label of the week", False,
     "With Record labels on, one label from your library on Home all week, with its albums. A new "
     "one each Monday.",
     "Switch on **Settings → Setup → Record labels**; the row then shows on Home."),
    # ---- Your collections
    ("favourites", "❤️", "Favourites", False,
     "A heart on every album. Hearted albums gather on a Home row.",
     "Tap the heart on an album's page. Tap the **Favourites** row's title for all of them."),
    ("later", "🕒", "Listen later", False,
     "Albums put aside to play another time, on a Home row and a screen of their own. Each comes off "
     "by itself once every track has been played.",
     "On an album, **⋯ → Listen later**, or select several on a wall. Open the list from "
     "**☰ → Listen later**."),
    ("playlists", "🎵", "Playlists", False,
     "Playlists you make, and Dynamic Playlists that follow a saved Library view. A playlist can be "
     "shared as text and imported, matched against the other library's tracks.",
     "**☰ → Playlists**, **☰ → Dynamic Playlists** and **☰ → Import a playlist**. A playlist's "
     "**Share** gives the text to send."),
    ("sharecard", "🖼️", "Share card", False,
     "The album as a picture, with links to hear it and read about it on the services you choose, "
     "and three related artists suggested beside it.",
     "Tap the share button on an album's page. Choose the services in **Settings → Setup → Share "
     "Card**. In the Android app, **Download** saves the card to Pictures/Mandarin."),
    ("wall", "📺", "Wall display", False,
     "A full-screen now playing page for a TV or tablet.",
     "Open `http://<server-ip>:3500/display` on the screen. Its options are in "
     "**Settings → Wall Display**."),
    # ---- The Android app
    ("android", "📱", "The Android app", False,
     "The same interface, plus lock-screen and notification controls, volume keys, a widget, a "
     "Quick Settings tile, a share sheet, Android Auto, and updates of its own.",
     "Download [mandarin-android.apk](https://github.com/meltface-80/Mandarin/raw/main/dist/mandarin-android.apk) "
     "and install it (Android 8.0 or newer). Enter the port; it finds the server on your Wi-Fi."),
    ("phone", "🎧", "This phone", False,
     "The phone is a player of its own: speaker, headphones or Bluetooth, with queue, history and "
     "radio. At home, your other devices can play to it while the app runs.",
     "In the Android app, pick **This phone** with the speaker button."),
    ("usbdac", "🔌", "USB DAC on the phone", False,
     "The app's own USB Audio driver plays to a DAC on the phone's port at the file's rate and depth, "
     "without Android's mixer; DSD natively or as DoP.",
     "Plug the DAC in. It shows on **This phone**'s page in **Settings → Audio Devices**; switch on "
     "**USB direct** there."),
    ("downloads", "⬇️", "Downloads", False,
     "Albums kept on the phone as the original files or Opus 256, played without the server. "
     "Smart Picks, the Album of the day and new albums can download by themselves.",
     "On an album, **⋯ → Download to this phone**. Quality, the download folder, Wi-Fi only and automatic "
     "downloads are in **Settings → Downloads** in the app."),
    ("onphone", "📂", "Music on this phone", False,
     "A folder of music already on the phone, watched for changes, shown on Home and played like the "
     "library. The server never sees these files.",
     "In the app, **Settings → Music Folders → On this phone** and choose the folder."),
    ("offline", "✈️", "Offline mode", True,
     "One switch: only the music on the phone shows, and the server isn't used. With no connection "
     "the app does the same by itself, and reconnects when it can.",
     "In the Android app, **☰ → Offline mode**."),
    ("away", "🌍", "Away from home", False,
     "On mobile data the app reaches the server through its own Tailscale, with no ports opened. "
     "Away, only the phone plays: Opus 256 or the original files.",
     "**Settings → Setup → Away from home** on the server: **Sign in to Tailscale**. Then in the app, the "
     "same page: **This phone**. Open the app once at home. Details under "
     "[Away from home](#away-from-home-tailscale)."),
    # ---- Setup
    ("ui", "🎨", "UI Settings", True,
     "Text sizes, grid layout (Auto, 3 or 2 columns, or List) and tile size, saved on each device. "
     "On a desktop, text goes up to +100%.",
     "Open **Settings → Setup → UI Settings** and pick from each list; it applies at once."),
    ("account", "👤", "One account", False,
     "One username and password, kept on the server. Devices sign in with SRP, so the password "
     "itself is never sent, and every signed-in device is listed.",
     "Create it on first visit from a device at home. **Settings → Account** lists devices, signs "
     "one out and changes the password. Forgotten: see [Your account](#your-account)."),
    ("power", "⏻", "Restart and shut down", True,
     "Restart Mandarin, or shut it down so it stops finding and controlling your speakers until you "
     "start it again. In Docker, only Restart.",
     "Open the side menu (☰) and tap the **power button** in its top-right corner, then **Restart** or **Shut down**. "
     "On a Mac, double-click **Mandarin** on the desktop to "
     "start it again (installed before v0.6.12? Run the install line once more for the icon). In "
     "Docker: `docker stop musicd-server`, then `docker start musicd-server`."),
    ("backup", "💾", "Backup and restore", True,
     "Back up settings, players, collection, API keys and the whole database, at home or away: to the "
     "server, or from the Android app to a file with its settings.",
     "Open **Settings → Backup & restore**, tick what to include, then **Back up to the server** (or, "
     "in the app, **Back up to a file on this phone**). To restore, pick a backup (or the file), tick "
     "the parts and tap **Restore**. Mandarin keeps a backup of how things were first, then restarts."),
    ("qobuz", "🎼", "Qobuz", True,
     "Sign in with your Qobuz subscription: your favourites and purchases become albums here, and "
     "the Qobuz browser plays anything in the catalogue, streamed through the server.",
     "**Settings → Services → Qobuz**: sign in. Then **☰ → Qobuz** to search and play; **+** on a cover "
     "adds an album to your Qobuz favourites (a **✓** once added) and so to the library, as does "
     "**⋯ → Add to Qobuz favourites** on its page. Details under [Qobuz](#qobuz)."),
    ("tidal", "🎵", "Tidal", True,
     "Sign in with your Tidal subscription on tidal.com: your favourite albums become albums here, "
     "and the Tidal browser plays anything in the catalogue, streamed through the server.",
     "**Settings → Services → Tidal → Sign in on tidal.com**: open the link, sign in there, come back. "
     "Then **☰ → Tidal** to search and play; **+** on a cover adds an album to your Tidal favourites "
     "(a **✓** once added) and so to the library, as does **⋯ → Add to Tidal favourites** on its page. "
     "Details under [Tidal](#tidal)."),
    ("updates", "🔄", "Updates", False,
     "The server updates itself from GitHub from Settings and checks every 12 hours. The Android app "
     "offers each new version when it opens.",
     "**Settings → Updates → Check for updates**, then **Update to vX.Y.Z**. The server restarts "
     "itself in a few seconds."),
]

MAX_WORDS = 30


def words(s):
    return len(re.findall(r"\S+", s))


def md_inline_to_html(s):
    out = html.escape(s, quote=False)
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: '<a href="%s">%s</a>' % (
        m.group(2) if not m.group(2).startswith("#") else m.group(2), m.group(1)), out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    out = re.sub(r"\*(.+?)\*", r"<i>\1</i>", out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    return out


def readme_block():
    lines = ["Every feature below has an **ⓘ**: open it for how to switch the feature on and use it.", ""]
    for i, (fid, em, title, new, what, how) in enumerate(FEATURES):
        lines.append("%s **%s**%s" % (em, title, " — *new since v0.5.50*" if new else ""))
        lines.append("")
        lines.append(what)
        lines.append("")
        lines.append("<details><summary><b>ⓘ</b> How to set it up and use it</summary>")
        lines.append("")
        lines.append(how)
        lines.append("")
        lines.append("</details>")
        lines.append("")
        if i != len(FEATURES) - 1:
            lines.append("⸻")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def site_block():
    # Site links: README anchors become the README on GitHub.
    def site_how(how):
        how = re.sub(r"\]\(#([^)]+)\)", r"](https://github.com/meltface-80/Mandarin#\1)", how)
        return md_inline_to_html(how)
    out = []
    for fid, em, title, new, what, how in FEATURES:
        t = html.escape(title)
        out.append(
            '      <div class="card%s"><h3><span class="em">%s</span>%s%s'
            '<button class="info" type="button" aria-expanded="false" aria-controls="how-%s" '
            'aria-label="How to set up and use %s">i</button></h3>\n'
            '        <p>%s</p>\n'
            '        <div class="how" id="how-%s" hidden><b>How to set it up and use it.</b> %s</div></div>'
            % (" is-new" if new else "", em, t, '<span class="new">New</span>' if new else "",
               fid, t, md_inline_to_html(what), fid, site_how(how)))
    return "\n".join(out) + "\n"


def replace_between(path, start, end, body):
    s = path.read_text()
    a = s.index(start) + len(start)
    b = s.index(end, a)
    path.write_text(s[:a] + "\n" + body + s[b:])


def main():
    bad = [(t, words(w)) for _, _, t, _, w, _ in FEATURES if words(w) > MAX_WORDS]
    if bad:
        sys.exit("Over %d words: %s" % (MAX_WORDS, bad))
    ids = [f[0] for f in FEATURES]
    assert len(ids) == len(set(ids)), "duplicate ids"
    replace_between(ROOT / "README.md", "<!-- features:start -->", "<!-- features:end -->", "\n" + readme_block() + "\n")
    replace_between(ROOT / "docs/index.html", "<!-- features:start -->", "      <!-- features:end -->", site_block())
    print("%d features; longest %d words" % (len(FEATURES), max(words(f[4]) for f in FEATURES)))


if __name__ == "__main__":
    main()
