# Changelog

Versioning: each set of changes is a development build and takes the next third digit
(0.3.0, 0.3.1, 0.3.2 …). The second digit moves only when the project owner says so.
`package.json`, the README title, the GitHub Pages badge and the Android app's
`versionName` (plus `versionCode`) move together — `npm test` fails if they don't.

## v0.6.1
- **Random Album and Album of the day sit under the greeting**, with no heading, ahead of
  every row. "Not played in 6 months" holds only albums you haven't played, and stays hidden
  until it has some (its first six months), unless switched off.
- **Now playing goes back.** Opened from the mini player over an album, its corner button
  returns to that album (with its previous/next) instead of going Home. On a desktop it's an
  ×; on phones and tablets a ‹.
- **Album view on larger screens closes with an ×**, and its cover starts below the corner
  buttons, with previous/next still on its centre line. Phones keep the ‹.
- **Now playing, reduced.** On large screens a button beside Back shrinks Now playing to the
  album view's size and back; the card can be dragged by its top strip. Remembered per device.
- **The Random Album disc speeds up smoothly** from where it is when tapped, instead of jumping.
- **API keys say whether they work.** The Discogs and FanArt.tv boxes show a brass ✓
  "Checked and working" or a red ✕ when the service refuses the key.
- Smaller fixes: the waveform redraws when its bar changes size; the share card no longer
  waits for ever on a font; ⓘ notes stay up long enough to read and are named for screen
  readers; the share card's × is a brass disc; leaving an artist's page through the side menu
  no longer brings it back on Back.

## v0.6.0
The release: everything in the release candidates since v0.5.50, settled.
- **Multi-disc albums show it.** An album of more than one disc — disc folders ("Disc 1",
  "CD2", "DISC 1"…) or disc numbers in the tags — has a two-disc symbol on its cover in every
  grid, bottom right, opposite the quality. Tracks in disc folders whose tags carry no disc
  number take the folder's.
- **The phone's symbol moved.** On an album's page, the sign that it's on this phone sits at
  the bottom right of the cover, no longer under the share button.
- **Random Album.** Home's "Play something unheard" tile is now Random Album: a brass disc in
  the middle of the tile, turning on its own centre, faster while an album is found.
- **Messages above the transport bar.** Toasts showed over the mini transport bar; they now
  sit just above it while it's on screen.

## v0.6.0-RC11
- **Back from an artist goes back to the album.** Tapping the artist on an album's page opens
  the artist's page; Back from there went to Home. Now it reopens the album you came from — the
  brass Back beside the menu and the phone's back gesture alike — and closing the album returns
  to where you started.
- **The artist page's Back is the brass < beside the menu**, as on every other screen, in place
  of its own "← Back" button.

## v0.6.0-RC10
- **Untagged albums named from their folders.** A file with no artist tag showed under "Unknown
  Artist", its album titled with the whole folder name. Now its names come from where it's filed:
  the artist from the folder above the album's (`808 State/10x10 (1993)`), or an
  "Artist - Album" folder; the album and year from the album's folder (10x10, 1993); the title,
  track and disc from the file name (`1-01 - Pacific State`). Only what the tags leave empty is
  taken; folders such as Music or 4tb are never an artist. Nothing is written to the files.
- **Then identified.** Those albums are looked up on MusicBrainz again under their new names, so
  a match can put back what folder names can't hold ("ex_el" → "ex:el"). The album page says when
  an album's names come from its folders.
- **Beatles are The Beatles.** Albums tagged "Beatles" and "The Beatles" were two artists: half
  the albums sat under "Also appears on", and each track carried the other name. Where the library
  has "The …", the albums tagged without it are shown under that name, so the artist page, search
  and links are one; it's filed under B either way. An artist you set yourself in Edit album stays
  as you set it.
- **Read once, only what's needed.** On the first start only the tracks without an artist or
  album tag are read again. Each album keeps its id, favourite, Listen later and play history.

## v0.6.0-RC9
- **Volume Levelling heard at once on Sonos.** Changing a Sonos room's Volume Levelling did
  nothing to what it was playing: a Sonos queue keeps the addresses it was loaded with, and only
  renderers were planned again on a change. Now the room's queue is planned again with the new
  gain and carries on from the same track and second (paused, it stays paused), as a renderer's
  does.

## v0.6.0-RC8
- **Album of the day stays put.** The server now chooses the day's album once, at the first ask
  after 00:01, and keeps it in its database. Before, it was worked out afresh on every ask from
  the date and the list of albums, so a scan that added or removed an album, or a restart or
  update while the library was being read, put a different album there mid-day — and one you had
  played came back as a "new" one. Now it is the same album on every device all day, through
  scans, updates and restarts; once played, from anywhere, it's gone until the next 00:01.
- **One album per folder.** Two copies of a record in two folders — "Random Access Memories
  (2013)" and "(2023)" — were shown as one album holding both sets of tracks, because an album
  was told apart only by its artist and title. Its folder now counts too: separate folders are
  separate albums, always. Disc folders inside an album's folder ("Disc 1", "CD2", "DISC 1",
  "cd 2"…) are still one album, shown disc by disc. The first start after the update puts merged
  albums right (one scan, no tags read again); favourites, Listen later, edits and identification
  stay with the album, and a renamed album folder stays the same album.
- **Mandarin's own words throughout.** Every tip, note, message and label carried over from the
  software Mandarin grew out of is reworded or gone; an unused streaming account, its browser
  and its menu entries are removed, along with its share card link.
- **README and site:** a list of everything new since the last beta (v0.5.50).

## v0.6.0-RC7
- **Volume Levelling, per device.** ReplayGain is now set on each device's own page (Settings →
  Audio Devices → the device, above DSP) rather than once for everything: Off, Track, Album or
  Auto. With it on, a **Target volume level** from −14 LUFS (the default) to −25 LUFS replaces
  the pre-amp, and **Volume adjustment when loudness is unknown** (0 to −12 dB, −5 by default)
  sets the level of a track with no ReplayGain tags. A phone's setting goes to the app, for its
  downloads too. Every device starts Off; the old Settings → Loudness page is gone.
- **Library Scanner.** Identify albums is renamed Library Scanner and sits under Music Folders.
  It holds **Measure ReplayGain** (what was Measure loudness), under Ask iTunes.
- **Help behind ⓘ.** Longer explanations on the settings pages — Library Scanner, Audio Devices,
  Downloads, Away from home — now open from an ⓘ after the setting's name, as Smart Picks' do,
  with a short line left under each. The ⓘ is the size of the name it follows.

## v0.6.0-RC6
- **Moving the music to another zone works.** Choosing another zone while something plays asks
  whether to move it there; Yes did nothing, because the page and the server named the two
  zones differently and the server refused the request without the page saying so. Yes now
  carries the queue over and plays on from the same track and second in the new zone (the old
  one stops), and a toast says it moved, or why it couldn't.

## v0.6.0-RC5
- **Every tag is kept.** The scanner reads all of each file's tags into the database — not only
  the names it shows — including identifiers (MusicBrainz IDs, barcode, catalogue number, ISRC,
  country) and ReplayGain. The library is read once more after the update to collect them.
- **Albums are identified by what their files carry, first.** A MusicBrainz release ID in the
  tags is taken as it is; then a barcode, then a catalogue number with its label, then the
  tracks' ISRCs — each before any search by name. iTunes is asked by barcode too. The Applied
  list says what matched ("matched by barcode").
- **ReplayGain.** Settings → Loudness: Off (the default), Track, Album or Auto, and a pre-amp.
  Auto takes the album's gain while a record plays in order and the track's when records mix.
  Peaks cap every gain, so nothing clips. On Sonos and renderers the gain goes into the stream
  (converted to FLAC); the Android app applies it itself, downloads included.
- **Loudness measured for files without tags.** A switch on the same page measures them on the
  server (EBU R128 loudness and true peak), one at a time in the background, with progress shown;
  an album's gain is worked out once all its tracks are known.

## v0.6.0-RC4
- **The app and the browser show the same Home row.** "Not played in 6 months" was fetched only
  while the row was empty: once it held tiles — including the Home saved for an instant open — it
  was never fetched again, so the app could show yesterday's Album of the day, or a one-album list
  left from an offline session, while the browser showed today's. It is now fetched afresh every
  few minutes and when you come back to the app or the tab.
- **Album of the day, in step everywhere.** A new one at 00:01 (in the server's time zone, `TZ`),
  the same on every device; once played — from any device — it's gone from all of them until the
  next 00:01. Each page asks the server every minute while Home is open, and on coming back.
- **Not played in 6 months waits for six months of listening.** Until Mandarin has been played
  for six months, every album would count as "not played", so the row offers only Play something
  unheard and the Album of the day; its full page says from which date albums will show.
- **The share card's Download saves the card in the app.** The button (there since the card was
  first made, for browsers) did nothing in the Android app, whose WebView ignores download links;
  it now saves the card to the phone's Pictures/Mandarin and says so.

## v0.6.0-RC3
- **DSD to UPnP/DLNA renderers, as it is.** A DSD64 album on a Chord Poly arrived as 176.4 kHz
  PCM: every renderer was sent DSD as PCM. Now a device that says it takes DSD files (in its
  GetProtocolInfo, as the Poly does) is sent the DSF or DFF file itself, named as the device
  names it — at the DSD rates its page has on: those known for its model (DSD64–256 for a Poly),
  or DSD64 for a device without a profile. Tap a DSD rate off on its page and that rate goes as
  PCM again. Now playing shows "DSD64".

## v0.6.0-RC2
- **"Play something unheard" plays again.** The tile on Home (and the compass) said
  "zone_or_output_id required": the page named the zone one way and the server read it another.
  Both now agree (and the server takes either), and the message says which album started.

## v0.6.0-RC1
The first release candidate for 0.6.0: everything up to v0.5.58, settled.
- **Release candidates update in order.** The app, its update check and the server's updater now
  read "-RC1" as a release candidate: 0.6.0-RC1 is newer than 0.5.58, RC2 newer than RC1 (and
  RC10 than RC2), and 0.6.0 newer than any of them. Before, the app ignored the "-RC1" and
  wouldn't have offered 0.6.0 over it.

## v0.5.58
- **Offline shows only what's on the phone.** With no connection, Home showed the server's albums
  (Random albums, Library and the rest), which then wouldn't open: the page painted the last Home
  it had saved while online. Offline it now shows only the phone's music folder and downloads;
  the saved Home is kept for the server, untouched.
- **Offline mode.** A switch at the top of the menu, and in Settings → Downloads: the app as if
  there were no connection — only the music on the phone, and nothing asked of the server (no
  Sonos rooms, downloads wait, no Tailscale), even when it could be reached. Off again, the server's
  library is back.
- **No server playlists offline**, and an album left open isn't reopened offline unless it's on
  the phone.

## v0.5.57
A review of the whole Android app, and everything it found put right.
- **Unplugging the USB DAC mid-song no longer crashes the app.** The stream was freed while the
  audio was still being written to it. Unplugging anything else (a USB stick) no longer stops
  the DAC either.
- **Removing downloads doesn't freeze the app.** Albums are deleted in the background, however
  many gigabytes.
- **Offline, the page stays where you left it.** After the network went with the app open, every
  return to the app reloaded the page to Home. Now it stays put, and goes back to the server only
  once the server answers.
- **Update doesn't freeze the screen** when a downloaded update is checked before installing.
- **Android's backup leaves out this phone's sign-in and Tailscale identity** (restored to a new
  phone, two phones would have shared them) and the caches, which it rebuilds.
- **A download cut short is never taken as finished.** Each track must arrive at the length the
  server gave; Opus downloads start a track afresh rather than joining two halves.
- **Downloads run with a notification**, so Android lets a big album finish in one go rather than
  stopping it every ten minutes.
- **Lighter on the phone:** the downloads list is read from storage once, not on every request;
  the space downloads use is counted in the background; the player never reads storage on the
  screen thread; and a big music folder is re-read less often while the app is open (in step with
  how long a read takes), still every half minute for most.
- **Reports to the server don't pile up** when it's slow: only the newest is sent.
- **An offline play the page was told had failed doesn't start a few seconds later anyway.**
- **Moving downloads doesn't cut off the track playing**: its old copy goes when the track is done.
- **No "Can't reach Mandarin" notification with no network**, and the widget no longer tries to
  start something Android refuses from the background.
- **Android Auto's Random and Smart Picks lists open faster** (covers fetched four at a time).
- **Phone-music covers and tags stay current**: a replaced cover is picked up, and Rescan tries
  again the files whose tags couldn't be read.
- **No offline play is lost** when one is made while earlier ones are being sent.

## v0.5.56
- **No freeze when the network goes with the app open.** The freeze report from v0.5.55 showed
  the cause: the lock-screen, notification and widget controls for a Sonos room were redrawn on
  the app's screen thread every time the server couldn't be reached, and each redraw copied the
  album cover to Android. They're now drawn on their own thread, only when something shown has
  changed, with the cover kept small and shared rather than copied. With no network they wait
  quietly instead of trying again and again.
- **Offline at once.** The app now follows the phone's network itself: when the last network
  goes, it switches to its own copy of Mandarin within a second (it could take up to ~45 s), and
  drops connections to the server that would only hang. When a network comes back, it looks for
  the server straight away.
- **No Tailscale with no network.** With no Wi-Fi or mobile data the app no longer starts and
  restarts its Tailscale connection for minutes; that also held up its other checks.
- **Connections that go silent are dropped** after a minute instead of hanging the page.
- **Back always does something.** If the page doesn't answer, Back leaves the app.
- **Missing covers come back.** A downloaded album whose cover didn't arrive with it gets it the
  next time the server is reached, so it isn't a blank tile offline.

## v0.5.55
- **The app opens with no signal at all.** With Wi-Fi and mobile data off (or no SIM), the app
  could sit on its start-up logo until force-stopped. With no network it now opens straight onto
  its own copy of Mandarin — Home, the phone's music folder, downloads and the player — without
  first setting up the way to the server, which needed a network. A VPN app left on with nothing
  under it no longer counts as a network.
- **Never held at the start.** If the WebView doesn't confirm its link to the server within a few
  seconds, the page opens anyway rather than waiting for it.
- **Back online by itself.** When Wi-Fi or mobile data returns, the app finds the server again
  and moves the page back to it; no force stop needed.
- **This phone in Audio Devices with no network.** Offline, Settings → Audio Devices said "the
  network is being searched" and listed nothing. It now lists this phone, with its page: the USB
  DAC on its port (and the switch to play through it), and its DSP, which can be changed offline,
  plays at once, and is handed to the server when it's back.
- **This phone is already chosen.** When the phone is the only player (no network, or away from
  home), the zone picker picks it, not "Choose a zone…".
- **The DSP curve offline.** The script that draws it is now part of the app's own copy.
- **A freeze leaves a note.** If the app's screen ever stops answering for ten seconds, what it
  was stuck on is kept, and the next start offers it to share — like a crash report.

## v0.5.54
- **One Settings list.** Setup's pages — Away from home, API Keys, Smart Picks, Record labels,
  Discover, Identify albums and Updates — are back on the Settings list, in the same order, where
  Setup was; the Setup page is gone. All fourteen fit on one screen, and Back from any of them
  returns to the list.

## v0.5.53
- **Settings closes from the left.** The × on the Settings list is now to the left of the title,
  where every page's Back is.
- **The side menu covers the mini transport bar.** The bar showed over the open menu; the menu
  now sits above it.

## v0.5.52
- **An album moved off the phone leaves Home at once.** Taking the last album out of the phone's
  music folder (moving it to the server, say) left its tile on Home until the app was closed:
  the app had noticed, but the Home row's "nothing here" step stopped with an error before it
  could redraw. Fixed, and the empty row hides as it should.
- **No change to the folder is missed.** A change noticed while the folder was being read was
  dropped; it is now read once more when the read ends, so an album moved out file by file is
  always caught. While the app is on screen the folder is read every half minute (every three
  minutes behind it), and coming back to the app shows the list as it stands straight away.
- **A tile that's out of date tidies itself.** Opening an album that has left the phone says so,
  takes its tile off Home and the Music on device wall, and goes back to where you were.

## v0.5.51
- **Play to another phone.** A phone running the Mandarin app is now a player for your other
  devices at home too: your phone lists the FiiO R7 (and the R7 your phone) under its own name,
  and can play, queue, pause, change the volume and move music to it, as with any room. To
  itself it is still "This phone". It shows while the app is running on it and the phone is at
  home; away from home it plays for itself only. Audio Devices → the phone → **Other devices can
  play here** switches it off. Before, a phone was only ever a player for itself.

## v0.5.50
- **Adding to the queue while the phone plays a download.** When the phone was playing a list of
  its own — a downloaded album played while the server couldn't be reached, or the phone's own
  music — an album added with Add to queue or Play next went to the server's queue, which the
  phone wasn't playing, and the phone dropped it without a word. Now it goes into the list the
  phone is playing: at the end, or straight after the current track. Downloaded tracks play from
  the phone, the rest stream, and the queue shows them with their covers. Play Now also leaves
  the phone's own list at once, so an album queued straight after goes where it should.

## v0.5.49
- **iTunes as a second opinion for identification.** An album MusicBrainz can't place is now
  looked up in Apple's iTunes catalogue too — no account or key, one request every 3.2
  seconds, a quarter-hour pause if Apple asks us to slow down. What iTunes finds is applied only
  when it fits exactly: every track there, every length within a few seconds, every name the
  same. Anything less is proposed. Apple's release date is often a reissue's, so the album keeps
  the year its files carry. Albums already unidentified are asked of iTunes once, by
  themselves, after the new albums; MusicBrainz isn't asked about them again. Find match in the
  album editor lists iTunes's albums too when MusicBrainz has nothing near, marked "iTunes".
  Settings → Setup → Identify albums → **Ask iTunes too** switches it off; `ITUNES_COUNTRY`
  picks Apple's store (US by default).

## v0.5.48
- **Away from home over the app's own Tailscale stays connected.** On Android, Tailscale
  re-reads the phone's network only every ten minutes unless its host app says the network
  changed and which connection carries the traffic — the Tailscale app does, Mandarin's engine
  didn't. So after Wi-Fi to mobile data, a new mobile address, or another VPN coming on or
  off, the tunnel kept using the old network for up to ten minutes and the app went offline
  while the server was fine. Now the app hands the engine the phone's default route with its
  interfaces, a change makes Tailscale look again at once, and when the server doesn't answer
  the app has Tailscale rebind its sockets before giving up.
- **No more "On this phone" screen at a cold start away from home.** Opening the app on
  mobile data could land on the app's own downloads screen, with "Try the server again"
  working at once: the app looked for the server once for three seconds while its Tailscale
  engine was still coming up, switched to its offline copy of the page, then took the first
  page load's late failure for the copy failing. Now it looks three times over about ten
  seconds before going offline, and a failure while the offline copy is up is left alone —
  that screen is only for an app with no copy of the page at all.

## v0.5.47
- **Many more albums identified.** Another pressing of the same record is no longer a rival:
  an edition with a bonus track, or a remaster, used to leave a 100 % match "proposed" because
  "two releases fit"; now the record is applied and the pressing is a detail. The search asks
  MusicBrainz for forty results rather than ten, a loose search by the title's words runs when
  the phrase finds nothing near, and when the best fit hasn't the copy's track count the
  record's other editions are fetched too — the deluxe the search didn't list. A release
  MusicBrainz has without track lengths is judged by its names and applied on an exact fit
  rather than left unidentified. Settings → Setup → Identify albums → "Check the proposed and
  unidentified again" runs the leftovers under the new rules.
- **Music folders from anywhere.** Settings → Music Folders works away from home too, over
  Tailscale — it used to answer "Change music folders from home".
- **No stray scrollbar in Settings.** While Settings is open the page behind it stays put,
  so a Settings page with nothing to scroll shows no scrollbar.

## v0.5.46
- **The repository is now `meltface-80/Mandarin`.** Every address the server, the page, the
  Android app and the docs carry now names the new repository: the update check, the APK
  download, the Tailscale engine download and the user-agent strings. GitHub redirects the
  old name, so installs on earlier versions still find this update. The Docker image, the
  container and the data volume keep the `musicd-server` name, so nothing changes for a
  running install.

## v0.5.45
- **Lighter previous and next discs.** The two brass discs on the album art are now much
  more translucent, so the cover shows through them; the brass rim and the dark chevron
  keep them easy to find. Pressing one still firms it up a little.

## v0.5.44
- **Previous and next on the album page.** An album opened from a list — a Home row, an
  artist's albums, a label's, the Library wall, search results — knows the albums beside it.
  Two discs at the top of the page step to them, a swipe left or right does the same on the
  phone, and the arrow keys do on a keyboard; each opens exactly as its own tile would. At the
  first or last album the disc for that direction is dimmed. Back still returns to the list.

## v0.5.43
- **Now playing shows the whole cover.** A framed square at a steady size, not bled to the
  screen's edges and no longer faded into the ground at the bottom; the tabs and the corner
  buttons sit above it, never over it.

## v0.5.42
- **Graphite and brass.** The theme is flat now: a warm charcoal ground in place of the green,
  no felt grain or mottle on the ground, Now playing or the panels, no glow under the covers.
  The brass is the one accent — the headings, the top bar's discs, play, the lit segments of
  the progress meters (which stay, on the mini player and Now playing), the volume controls
  and the glyphs — and the plum is gone. The app's window matches before the page loads.
- **The icon to match.** The app's launcher icon and the home-screen icon of the web app are the
  duck in brass on the same charcoal.

## v0.5.41
- **The download folder is its own setting.** Settings → Downloads → Download folder: a folder
  of your own on the phone or an SD card, chosen on its own — nothing to do with the music on
  the phone. Before, downloads could only go into the music folder's Mandarin sub-folder, and
  forgetting that folder hid the downloads with it. A phone set up the old way carries on with
  the same place, now remembered separately.
- **Music on this phone watches its folder.** The folder is read again by itself when Android
  reports a change in it, when the app comes back to the front, and every few minutes while
  the app is open; a read of an unchanged folder is a listing, the tags kept from last time.
  Music moved away goes from the Home row, which hides when there is nothing in it; music
  added shows up. The setting has moved to Settings → Music Folders, with the server's.
- **The server's music folders are watched too.** A folder added, files copied in, an album
  deleted or renamed are noticed through the file system's own notifications and read within a
  minute, gathered into one scan; the timed rescan stays for what the file system doesn't
  report (a change made on a network share from another machine).

## v0.5.40
- **Native DSD over USB (Stage 9, part 3).** A DSF or DFF file goes to the DAC as DSD: natively
  on the DAC's DSD alternate setting (the Audiolab 8300CD: DSD64, 128 and 256), or as DoP on a
  DAC that takes 24-bit PCM at a sixteenth of the DSD rate. The app reads both containers
  itself (Media3 knows neither), and the DSD setting on this phone's page chooses Native,
  Native with the words reversed (for a DAC that plays noise the usual way), DoP, or PCM from
  the server as before. A DSD track the DAC can't be given is sent again as PCM.
- **Hi-res as it is, with USB direct.** The phone tells the server what its DAC takes — rates,
  depths, DSD — and the server plans the queue for it like a renderer's: a 24/96 or 24/192
  file as it is where the DAC takes the rate (the Sonos 24/48 rule no longer applies), FLAC at
  the best rate the DAC takes otherwise. The queue is planned again the moment the DAC comes,
  goes or changes, from where it was. The badge reads "USB DSD64 ✓" or "USB DoP DSD64 ✓".

## v0.5.39
- **USB direct: silence on the next track, fixed for real.** The diagnostics showed it: the
  stream opened for a new track was never started. ExoPlayer says play once, when playback
  starts, not again when the sink is configured for the next track — Android's own sink
  restarts its track itself, and the USB sink now does the same, so a skip, a new album or a
  format change plays on. (v0.5.38's engine change stands: the packets run continuously.)
- **Discogs token back on the API Keys page.** Its block was hidden from before record labels
  existed, so the token could never be entered — and without a Discogs token or a FanArt.tv
  key the logo pass had nothing to look with. Saving either now starts the pass at once.

## v0.5.38
- **USB direct: the DAC's volume starts low.** A DAC with a USB volume control came up at
  its own level — the DragonFly at full. The driver now sets the volume before the stream
  starts: at 10% whenever USB direct is switched on or a DAC is plugged in, and where the
  slider was set since on the tracks that follow. The slider follows a
  loudness curve (50% is -18 dB, 20% is -42 dB) rather than a straight line across the DAC's
  stated range. The Audio Devices page shows the level and the DAC's range while streaming.
- **Fixed volume, a volume limit, and the phone's buttons.** Under USB direct: a Fixed
  volume switch — on, the DAC is driven at full and the amplifier sets the level (the
  default for a DAC with no USB volume control); off, the slider and the phone's volume
  buttons drive the DAC's own control, or scale the samples in software for a DAC without
  one (the default for a DAC with its own control, like the DragonFly). A volume limit
  (default 80%) that the slider can't pass, so a DAC on headphones is never driven to full.
  The phone's volume buttons, the lock screen and Bluetooth controls move the USB level
  while the app plays through the DAC (the media session reports a remote device).
- **USB direct: silence after a skip or a new album, fixed.** The stream was stopped and
  restarted on every pause and seek, and the DAC could go quiet after that until its
  interface was selected afresh; the track then ran on with no sound and moved on. The
  engine now runs the packets continuously while the stream is open — PCM while playing,
  silence when paused, between tracks or on an underrun — so a skip only empties the
  buffer. The position counts only PCM the DAC has taken, and a stream that stops
  completing packets for a second is reopened from where it is. The diagnostics carry
  the engine's last events.

## v0.5.37
- **Bit-perfect USB (Stage 9, part 2).** With USB direct on (this phone's page in Audio
  Devices), the app plays through its own USB audio driver: the DAC is fed the track at its own
  rate and at the DAC's depth, Android's mixer out of the way — bit-perfect with the DSP off,
  the DSP's output at the DAC's rate with it on. Asynchronous DACs are paced by their feedback;
  adaptive and synchronous ones by the clock. The DAC's own USB volume control, where it has
  one, is what the volume slider drives (the DragonFly); otherwise the volume is fixed at full.
  A rate the DAC doesn't take, or the DAC unplugged mid-track, falls back to Android's track.
  The badge reads e.g. "Lossless · USB 24/44.1 ✓"; the page shows the stream's feedback and
  underrun counts. DSD comes in part 3. (Merged into v0.5.36 first; this version exists so
  the app's updater offers the build.)

## v0.5.36
- **The USB DAC, found and read (Stage 9, part 1).** In the Android app, a DAC on the USB
  port shows on this phone's page in Audio Devices: Android's permission for it (asked once),
  then what its descriptors say — USB Audio Class 1 or 2, sample rates (a UAC2 DAC's clock is
  asked for its range), bit depths, native DSD, a USB volume control, the bus speed — with a
  Copy button for the full diagnostics. Plugging a DAC in offers Mandarin. Nothing plays
  through it yet: that is part 2, and the USB direct switch waits for it.
- **The duck, bolder and in orange.** A Mandarin duck's orange on the plum, the line art
  thickened, centred on the duck itself and larger, and the level meter gone: the duck alone
  is the icon, on the launcher and the web app alike.

## v0.5.35
- **The icon in plum.** The duck is white now, on the plum of the transport controls, with the
  gold level meter kept: the Android launcher (square, round and adaptive), the web app's
  icons, the Apple touch icon, the favicon and the site's.

## v0.5.34
- **A Playlists row on Home.** Your playlists and the Dynamic Playlists on one shelf (the
  side menu keeps their two screens): yours first, newest change first, then the Dynamic ones
  marked "Dynamic · N albums", each a mosaic of its albums' covers. Tap a tile to open it, the
  title for the Playlists screen. In the Home Screen settings like the other rows; hidden
  until there is a playlist to show.

## v0.5.33
- **Tracks added to a playlist are completed from the library.** An entry that arrives
  without everything the stored record needs (the album's id, its title, the track's title)
  is filled in from the library — the album by its id, else by its names; the track by its
  place on the album when the title agrees, else by its title — instead of being skipped. When
  one still can't be stored, the toast says why ("album not in the library", "track not on
  that album"). Fixes a playlist saved with 0 of its tracks.

## v0.5.32
- **Playlists can be named in the Android app.** "＋ New playlist…" (from chosen tracks or
  albums), Focus → "Save as…" (a Dynamic Playlist) and "Save as a playlist" after an import
  used the browser's own name box, which the app's WebView has no dialog for: it answered
  "cancel" every time, so the sheet closed and nothing was made. The page now asks with a
  dialog of its own, in the app and the browser alike.
- **Sharing is MusicD Remote's format.** A playlist shared from here (Share → the MDRP1
  text) imports into MusicD Remote, and one shared from there imports here, with the same
  found / substituted / missing report. Covered by tests now.

## v0.5.31
- **Labels for albums whose files carry none.** With Record labels on, each album without a
  LABEL tag is looked up in the background — MusicBrainz first (a release by that title and
  artist, its label), then Discogs with your token — and kept by the album's identity, so a
  library rebuild keeps it; a miss is asked again after a month, or at once with Force rescan.
  The files' own tag always wins. The Settings page counts tagged, looked-up and untagged
  albums; the scan log says what each lookup found. (Stage 8, part 3 — the last.)

## v0.5.30
- **Merged labels and logos.** On the Labels screen, hold a tile to select labels and merge
  them into the first (the tile shows "N merged"; tap that to undo one at a time). Logos are
  found in the background for every label without one — Discogs first (your Discogs token in
  Setup → API Keys), then FanArt.tv by the label's MusicBrainz id (your FanArt.tv key) — and
  kept in the data folder, served like album art. On a label's page the picture button offers
  Discogs' candidates or takes a pasted address. The Settings page counts the logos; Force
  rescan looks again for the ones not found. (Stage 8, part 2.)

## v0.5.29
- **Record labels, from the tags.** Settings → Record labels (off by default) turns on a Labels
  screen in the side menu, the label on the album page and share card, labels in search, a
  Record label facet in Library Focus and a Label of the week row on Home. Each album's label
  is its files' LABEL tag, read with the library; spellings of one label fold together
  ("Blue Note Records (UK)" is *Blue Note*), and a name that isn't a label's (a management
  company, "Unknown") is left out. A library filed by label can take the label from the
  folder at a set depth instead. The Settings page counts the albums with and without a label
  tag. Merges, logos and lookups for untagged albums follow. (Stage 8, part 1.)

## v0.5.28
- **Listen later.** Put an album aside to play another time: on its page, ⋯ → Listen later, or
  select several albums on a wall and choose Listen later. They are a Home row and a wall of
  their own (also in the side menu), newest first, kept on the server by the album's identity
  so they survive a rescan. An album comes off the list by itself once every one of its tracks
  has been played since it was put aside — on any zone — or by hand. (Stage 7, the last of the
  roadmap.)

## v0.5.27
- **Downloads that outlive the app.** Settings → Downloads → Save to now offers the music
  folder's own “Mandarin” folder (the folder chosen for Music on this phone, on the phone or an
  SD card) beside the app's private storage. Albums saved there survive an uninstall: a fresh
  install pointed at the same folder finds them again, each album's own index file being the
  record. Writing plain files there needs Android's all-files access, granted once in the
  system settings (the page has an Allow button). “Move all here” carries existing downloads
  over, album by album, with progress; albums on a card that is out show as away rather than
  vanishing. The private store stays the default. (Stage 6.)
- **The Home row for music on the device shows.** It is called *Music on device*; the server's
  saved Home row order didn't know the row, so the page never showed it.

## v0.5.26
- **Music on this phone.** In the Mandarin app, Settings → Downloads → Music on this phone
  takes a folder chosen with Android's folder picker — purchases waiting to be moved to the
  server. The app reads its tags and covers (the folder's own “Mandarin” sub-folder is for the
  server's downloads), keeps a small index on the phone, and shows the albums on Home as
  “On this phone”, with a wall and an album page of their own. They play on the phone, through
  its DSP, whatever zone is picked; the page shows what's playing and the queue as for any
  zone. The server never sees these files. (Stage 5.)

## v0.5.25
- **Headphone profiles from AutoEq.** On a device's DSP page — the phone's, or a renderer
  feeding a headphone amp — choose a headphone by name: AutoEq's index of measured headphones
  and earphones is fetched once a day and kept in the database, the chosen profile fetched once
  and kept for good, and its bands (up to ten, with the profile's own preamp) run before the
  PEQ's. A profile can also be pasted from a ParametricEQ.txt. Headroom stays automatic: the
  profile's preamp when it covers the bands' combined peak, else half a dB under that peak.
  (Stage 3, complete.)

## v0.5.24
- **DSP on the phone.** The Mandarin app has its own engine: the phone's setting (Audio
  Devices → this phone, at home or away) runs on everything the phone plays — the server's
  stream, Opus away from home, downloads — in 64-bit float, the headroom first, then the
  bands, out to Bluetooth, USB or the speaker as float. The setting comes with the app's
  hello and whenever it is saved, and is kept on the phone so it applies offline. The badge
  reads "· DSP" while the engine is at work. (Stage 3, second part; AutoEQ profiles next.)

## v0.5.23
- **DSP for UPnP/DLNA renderers: a parametric EQ per zone.** On a device's page in Audio
  Devices, a DSP switch and up to ten bands — peak, low shelf, high shelf, low-pass,
  high-pass — with the response drawn as they are edited, and Save. With DSP on, every track
  is decoded to 64-bit float, the headroom taken, upsampled if the Output settings say so,
  the bands run (double precision), then dithered once to 24 bits (32 where the device takes
  it); off, the device gets the file as stored, as before. Headroom is automatic — half a dB
  under the bands' combined peak, not the largest band — or set by hand. A change is heard
  from the next track. Sonos rooms have Trueplay and no DSP. The phone's own engine and
  AutoEQ headphone profiles follow in the next two versions. (Stage 3, first part.)

## v0.5.22
- **Opus 256 is 24/48 end to end.** Opus is a 48 kHz codec; a 44.1 kHz file now reaches the
  encoder through the same 64-bit float SoX resample as the FLAC conversions (it was ffmpeg's
  default resampler), and the encoder is fed float. On the phone the app carries Media3's own
  Opus decoder over libopus, built into the app, which decodes to float where Android's decoder
  gave 16-bit; the audio path to Android's mixer is float. The Now playing badge reads
  "256 · 24/48" when that decoder is at work. New Opus files are made afresh on the server;
  Opus downloads already on the phone stay as they were. (Stage 2 of the roadmap.)

## v0.5.21
- **Away from home, Audio Devices shows this phone.** The page was empty on mobile data, since
  it is a home-only page and the app over Tailscale counts as away — yet the phone is the one
  player there is away, and its own settings live on that page. The app now sees the phone it
  is on there, and nothing else; Sonos rooms and streamers, and the network search, stay at
  home. A browser away still sees no devices. (Stage 1 of the roadmap.)

## v0.5.20
- **More of the plum.** The top bar's menu and search and the album view's back, home and
  share are now a plum disc with the glyph in the pale plum; the side menu's icons are the
  plum; the open search box is a plum pill with a plum glass; and the volume controls, on Now
  playing and above the mini player, are plum through — speaker, number, 0 and 100, − and +,
  and a slightly smaller thumb.

## v0.5.19
- **The duck's purple.** Mandarin's buttons take a plum: the top bar's menu, search and
  settings and the album view's back, home and share sit on a pale plum disc with a plum
  ring and a plum glyph; the glyphs on their own — the mini player's zone and volume, Now
  playing's device, volume, previous and next, and the icons down the Settings list — are the
  same plum; play/pause, on Now playing and on the mini player, is a plum disc.
- **One look.** Mandarin Light and the Settings → Appearance page are gone; the theme is
  Mandarin, the dark one. The sample rate badge on artwork is always on, so its switch went
  with the page.
- **The PWA and the Android app are the same page.** Settings fills the screen and lists its
  pages as the side menu does, with a close button, in the browser and on the phone alike;
  the app's own stylesheet keeps only what the WebView needs.

## v0.5.18
- **Now playing's seek bar is the same level meter as the mini player's** in the Mandarin
  themes: gold segments over faint ones, the thumb riding along them. A track with a waveform
  keeps its waveform, as before.

## v0.5.17
- **An update no longer loses what was playing.** A Sonos room keeps its queue on the speaker,
  but a phone's and a UPnP renderer's lived only in the server's memory, and an update ends in a
  restart — so the queue was gone and the page said nothing was playing. Those queues are now
  kept in the database as they change (the place in the track every ten seconds while it
  plays) and put back when the server starts. A renderer still playing the track it was given
  is recognised at once and carries on to the next; the phone zone shows its track, paused,
  until the app reports in, and the app is handed the queue back if it was restarted too. The
  app also starts playing again by itself once the server answers, where playback had given
  up during the outage. Browser, PWA and app alike, since the page only shows what the
  server holds.

## v0.5.16
- **Opening the search no longer makes the top bar taller.** The search box was 48px against
  the 40px buttons beside it, so the bar grew by 8px and the whole page shifted down each
  time it opened, and back when it closed. The box is now the buttons' height.

## v0.5.15
- **CI no longer hangs on ffmpeg.** The test and release jobs installed ffmpeg with apt, and
  a GitHub runner whose apt mirror stalled sat in that step for the whole hour. They now take
  a static ffmpeg build from a cache (no apt), and the jobs are capped at fifteen minutes.

## v0.5.14
- **The search bar's × closes it too.** With text in the field the × clears it, as before;
  tapped again with nothing to clear, it closes the bar (what tapping away does). Browser,
  PWA and the app alike.
- **Android app: the mini transport bar keeps out of the keyboard.** The app's WebView
  shrinks the page to fit above the keys, so the bar rode up and sat on them while you typed.
  While a text field has the focus the app hides it; it is back the moment typing is done.
  The PWA on an iPhone never had this, and is unchanged.

## v0.5.13
- **Smart Picks, tidied.** The Home carousel no longer shows the "Because you have been
  playing…" line under each tile (it is on the Smart Picks page). On that page every card
  lays out the same: a long reason used to push the text under the cover on that one card.
  The button that opens a pick's album page now says **Open**, which is what it does.

## v0.5.12
- **A paused track survives the phone's sleep.** Android stops the app's idle player after a
  while; when it came back, its hello to the server started the phone zone afresh and what was
  paused was gone ("nothing playing"). The server now keeps the phone's queue across a hello
  and hands it back; the app puts it on its player at the same place, paused, without fetching
  a byte until you press Play. The zone shows the paused track throughout.
- **The way to the server is repaired without airplane mode.** Away, once the page had fallen
  back to the app's own copy, it only asked the server whether it was back — it never had the
  route looked at again, and the Tailscale engine's tunnel can go stale while the phone sleeps.
  Only a change of network (airplane mode on and off) mended it. Now the offline watch checks
  and repairs the route each time it looks, the phone player does the same after three
  failures in a row, and an engine that still can't reach the server after its connections are
  dropped is started afresh (its sign-in is on disk, so that takes seconds).
- **The album page opens smoothly in the app.** On the WebView, three things cost frames while
  the panel slid in: a blur over the whole page behind it (hidden by the panel anyway), the
  panel's full-screen shadow, and a blurred ambient layer under a moving panel. The app's
  stylesheet drops all three (the ambient wash stays, unblurred — a tiny cover scaled up is
  soft enough), and the cover is decoded off the main thread.

## v0.5.11
- **Find match in the album editor.** Album page → ⋯ → Edit album now has, under the cover, a
  **Find match** button like Find cover: the releases MusicBrainz has for the album, scored
  and listed best first with the year, the pressing, the country and the track count, and a
  *Match* or *Likely* mark on the top one. Tap one and it is applied at once — artist, title,
  year and every track title — with the editor and the album page following; Undo is on the
  Identify albums page. Under the list, a box for the **barcode** or a MusicBrainz link, for
  an exact match.

## v0.5.10
- **A ripper's "null" is not part of a name.** Tags like `null: Line Up (null)`, `Line Up -
  undefined` or `(Unknown)` are tidied before anything is compared, searched for or paired,
  so such an album scores as its titles deserve and every track takes its release name when
  the album is matched. (Albums already applied with those tracks left unpaired: Undo, then
  Check again.)
- **Match by barcode or link.** Every proposed, unidentified or declined row on the Identify
  albums page has a **Barcode…** button: type the digits under the bars on the sleeve, or paste
  the address of the release (or the album's release group) on musicbrainz.org, and that
  release is written to the album whatever the scan thought — the surest match there is, since
  a barcode names one pressing. The row then says *matched by barcode* (or *link*), with Undo
  as for any applied match.
- **A copy missing a track is still the record.** The search no longer asks MusicBrainz for
  exactly the copy's track count (an eleven-track release never came back for a ten-track
  copy: "nothing with this title"), and tracks are paired by likeness of title and length,
  not by number, so with track 3 gone tracks 4 to 11 still find their own. Each release track
  missing from the copy costs a little (beets' 0.9), each track the release hasn't a little
  less (0.6), instead of a flat penalty for the count; a ten-of-eleven copy with everything
  else right is applied. A paired track takes its release track's name; one paired with
  nothing keeps its tag. The page says "1 track of the release missing here".

## v0.5.9
- **Identify albums names the album, not the pressing** — Roon's model, in MusicBrainz's terms.
  The record you have is one *release* of a *release group*; the group is the album. The scan
  now searches with the edition set aside ("Kid A", not "Kid A (2015 Remaster)"), scores a
  tag title against both the group's and the release's, and treats a tag year as right when it
  is the original's or the pressing's or the one the title names. What it writes is the
  **group's title and its first release year** (1988, not 2015) and track titles with any
  remaster tail removed ("Tune 1", not "Tune 1 - 2015 Remaster"); "(Live)", "(Deluxe
  Edition)" and a featured artist are part of a name and stay. The page shows the pressing's
  own facts beside the album — *2015 remaster · released 2015*.
- **Check the proposed and unidentified again** on the Identify albums page: forgets those
  verdicts (not declined, not applied) so the scan revisits them with the new scoring.

## v0.5.8
- **Identify albums** (Settings → Setup → Identify albums). A scan that finds each album's
  right names on MusicBrainz — no key, one request a second, the app named in its User-Agent —
  from what the files already say: the title, the track count, the artist where the tag can be
  trusted (never "Various Artists", "Unknown", blank or the album's own title), and above all
  each track's title and length. The likeliest releases are scored beets-style (distance 0 to
  1: album 3, artist 3, year 1, track count 3, per track title 3 and length 2, lengths free
  within 15 s). At most 0.04 apart — 96 % alike, the 95 % asked for — the match is **applied**:
  artist, title, year and the track titles are written to the database, the album edit overlay
  and a new `track_edits` overlay, and the files are never touched. Up to 0.15 it is
  **proposed** on the page with Accept and Reject; beyond that, or when two different releases
  fit equally, the album is **unidentified** for you to name by hand (tap the row, then ⋯ → Edit
  album). Applied names have **Undo**; every verdict is kept (`album_matches`), so an album is
  looked at once, an unidentified one again after a month, and none you edited by hand at all.
  Verdicts and overlays survive rescans and a rebuilt database.
- **Scheduling** on the same page, on by default: the scan runs between a start and an end time
  each night (01:00–06:00 to begin with, the server's clock; a window over midnight works). Off,
  it runs whenever the library isn't being scanned — about twelve albums a minute — until every
  album has been looked at. Progress and what it is doing right now are shown on the page.
- The ⋯ menu on an album's page opens **above** its button, so every item is on screen
  without scrolling.
- `MUSICBRAINZ_URL` and `IDENTIFY=0` for tests and odd setups (a mirror, or no scan at all).

## v0.5.7
- **Favourites.** Every album's page has a heart, first in its row of buttons (the size of the
  ⋯ button at the other end): hollow, red once tapped, kept on the server by the album's
  identity so it survives a rescan. A **Favourites** carousel on Home shows them the moment one
  is hearted, newest first; tapping its title opens the full wall. It is in Home Screen's list
  of rows like the others.
- A written plan for finding an album's right names from its tracks —
  `docs/specs/album-identification.md` — for review before anything is built.

## v0.5.6
- **Renderers send their changes (UPnP events).** Mandarin subscribes to each renderer's
  AVTransport events (GENA) with a callback on its own port, renews in time, and reads the
  device the moment it says something changed — a pause from the device's own app, a track
  ending — instead of asking every second. Position isn't evented, so a playing device is
  still read every few seconds for it, and every second while its page is open. A device that
  refuses subscriptions is polled as before. The device's page says which: *Updates: sent by
  the device (events)* or *read every few seconds*. Docker users need host networking for the
  callback, as they do for streams.
- **Fixed volume is a switch** on a renderer's page (never a Sonos room, never a TV): on, the
  device's own knob or fixed line out is the volume and Mandarin shows no slider; off,
  Mandarin's slider and mute drive it. The Chord Poly's profile starts it on.
- **OpenHome is recognised.** A renderer that also offers OpenHome's services (Linn,
  upmpdcli, some Naim/Auralic) says *UPnP AV + OpenHome* on its page; it is still driven
  through AVTransport.
- Not planned any more: WiiM multiroom grouping. DSD comes when the owner says.

## v0.5.5
- **The mini transport bar is always there** — on Home, on every album wall, whether or not
  anything is playing — so a zone can be picked from it (the speaker button) without a trip to
  Audio Devices. With no zone chosen it reads **No Zone Selected**; with a silent zone, the
  zone's name and *Nothing playing*. Nothing is picked for you any more: the zone picker in
  Audio Devices starts on *Choose a zone…* until you choose, and the zone you chose is
  remembered. The volume button with no zone opens the zone picker instead.

## v0.5.4
- **Android: Settings looks like the side menu.** The Settings list and Setup's are rows the
  way the menu draws them — the icon in the menu's grey, then the title, flat on the sheet —
  instead of boxed tiles stretched to fill the screen. Same icons, same order. The browser and
  the iPhone app keep their two-column tiles.

## v0.5.3
- **Upsampling.** A renderer's page has an Output section: **Original**, **Upsample ×2**,
  **×4** or **Max**. Upsampling stays in the file's family (44.1 → 88.2 → 176.4; 48 → 96 → 192),
  capped at the highest rate the device takes; a file already at the top plays as it is. The
  conversion runs in 64-bit float — SoX at 33-bit precision, libswresample carrying doubles —
  with triangular dither to **24 bits**, or **32** where the device takes it, the setting allows
  (Auto / 24 / 32) and the server's ffmpeg writes 32-bit FLAC (6.1 stops at 24; the page says
  so). A CD rip at ×4 converts at about fifty times real time on a small desktop CPU.
- **Verified.** On a WiiM, a few seconds into each track its own API is asked what the decoder
  is running; when it matches what was sent, the rate and depth get their ✓ on the device's
  page and the Now playing badge reads, say, *FLAC 24/176.4 ↑×4 ✓*. A mismatch is shown as
  the device's last trouble.
- **Random album radio is per device.** The one switch at the top of Audio Devices — which
  applied to whichever zone the picker showed — is gone; each device's page has its own,
  under its on/off switch. It is the same per-zone setting the server always kept, now shown
  where it belongs, and a Sonos room in a group shows its group's.

## v0.5.2
- **A switch on every device.** A renderer found on the network is **off until you turn it
  on**: it is listed in Audio Devices with its details, but not offered as a zone. A Sonos room
  is on until you turn it off, which takes it out of the zone picker and the room list (a group
  stays while any of its rooms is on). The switch is on the device's row and at the top of its
  page; its state is kept in the register, so it survives restarts. Switching a playing renderer
  off stops it and lets its queue go. Phones have no switch — a phone is always its own player.
- Upsample ×2, ×4 and Max move to v0.5.3.

## v0.5.1
- **UPnP/DLNA renderers play.** A WiiM, a Chord Poly, any renderer with AVTransport that
  takes FLAC is a zone: pick it in the zone picker and the queue, play next, the transport,
  seek, volume and mute, history, Random album radio and moving what is playing all work on
  it as on a Sonos room. The server keeps the renderer's queue (it has none of its own) and
  hands each following track over with `SetNextAVTransportURI` once its file is complete, so
  tracks join gaplessly on a device that honours it; a device that does not is started on the
  next track by hand. A device whose volume is fixed (a Poly feeding a Mojo) has no slider.
- **Original mode.** A file goes to a renderer as stored wherever the device takes its rate,
  depth and format — the chips on its page decide — and above that as FLAC at the highest
  rate the device takes in the file's family. Renderer stream URLs say what they carry
  (`…orig.flac`, `…48000-24.flac`); Sonos URLs and the 24/48 rule are untouched. The Now
  playing badge on a renderer says exactly what was sent: *FLAC 24/96*.
- **Between players:** a queue moved to or from a renderer is rebuilt from the library for
  the player it goes to, so each gets its own best stream.
- The spec's non-goals are now firm: no Roon Ready (RAAT), Bluetooth or AirPlay, ever.
- Tests: the fake renderer gained a transport that fetches what it is given, plays in real
  time and moves to the next URI by itself (or stops, when told to fault on it); the new
  end-to-end run covers bit-perfect and converted playback, gapless, the fallback, transport,
  volume, modes and transfers, beside the Sonos run, which is unchanged.

## v0.5.0
- **Audio Devices sees every player.** Settings → Audio Devices lists the Sonos rooms, the
  phones running the app and — new — the UPnP/DLNA renderers on the network (a WiiM, a Chord
  Poly, any streamer, receiver or TV that offers AVTransport), found by SSDP every minute or
  by **Look again**, or named in `UPNP_HOSTS`. Each is read: its description, what it
  advertises it can play (ConnectionManager), and — for LinkPlay/WiiM firmware — its own
  HTTP API, for the name the WiiM app uses and the firmware.
- **A device's page:** a name of your own (stored on the server, shown in the zone picker,
  Now playing and everywhere else; the Sonos app keeps its own), what it is, and its
  capabilities as chips — sample rates, bit depths, DSD (later), formats — each marked with
  where it came from: known for the model (WiiM range, Chord Poly), advertised, ticked by
  you, or confirmed by the device. On a renderer, tapping a chip changes what Mandarin may
  send it; Sonos rooms and phones are read-only. A device that has gone can be forgotten.
- **The register** (`audio_devices`) survives a library rebuild, like your edits and history.
- Playing to the renderers — Original, Upsample ×2, ×4, Max — follows in the next versions,
  per the spec. Nothing about Sonos playback changed.

## v0.4.3
- **A written plan for UPnP/DLNA renderers** — `docs/specs/audio-devices-upnp.md`: discovery
  of WiiM, Chord Poly and other renderers, a device register with editable names, the
  capability layers (advertised, known model, you set, verified), the Audio Devices page,
  Original / ×2 / ×4 / Max upsampling in 64-bit float out to 24 or 32 bits, gapless via
  `SetNextAVTransportURI`, verification through the WiiM's own API, the phased builds
  (v0.5.0–v0.5.3) and the tests. Nothing is built yet; Sonos stays as it is throughout.

## v0.4.2
- **The album view:** each track's length sits on the right of its row, as far from the right
  edge as the track number is from the left; the album's text is white rather than cream,
  which read as washed out; **Queue** is gold like **Play now**.
- **Two themes: Mandarin Dark and Mandarin Light.** The four originals (Dark, Light, Copper dark,
  Brass light) are gone. Mandarin Light is the same look on warm cream paper — felt-green ink
  and fills, an old gold for the small capitals, the covers still glowing in their own colour.
  Anyone on an old light theme moves to Mandarin Light, everyone else to Mandarin Dark.
- **The side menu, sign-in page and home-screen icons show Mandarin's badge everywhere.** A
  phone could keep showing the old black duck from its cache; the icons now have new
  addresses, so every device fetches the badge.
- **The README and the website are in Mandarin's look:** the "Mandarin by MusicD" logo (a dark
  and a light version, following the reader's setting), green felt and gold (cream in light
  mode), and the app's own typefaces.

## v0.4.1
- **Android: the phone's Back button steps back one level**, the way the page's own buttons do:
  a dialog, the zone or volume pop-up, the menu, the share sheet, the album or Now playing,
  then from any album wall to Home. Only on Home does it leave the app. Before, Back from an
  album or a wall either left the app or went back a whole page load (a reload), which is much
  of why the app felt less smooth than the PWA. The app also draws a little beyond the screen
  now, so carousels and walls have their tiles ready as you move.
- **Random albums turns over every time you come back to Home** — in the app and the PWA alike
  (it used to keep the same albums for five minutes).
- **The share card is near-instant.** It's drawn at once from what the server already knows
  about the album (no online lookups first), with the cover the page already has; if a
  fuller lookup then finds more (a review for the first time), the card is redrawn with it.
  The suggested albums follow a moment later, as before. The card's font is now the bundled
  one — the page no longer waits on Google Fonts, which could stall in the app and away.

## v0.4.0
Mandarin, in its new look (Late-Night Hi-Fi, v0.3.25; the name, v0.3.26), with its own icon and
one last fix:
- **Mandarin's icon: the MusicD duck as a receiver badge.** The duck in cream on the felt,
  inside a gold hairline, over a gold level meter — the Android app's launcher icon (adaptive,
  round and square), the home-screen and browser icons of the web app, the sign-in page and
  the side menu. The MusicD logo itself is unchanged, and still heads the README and the site.
- **No blue box on tap.** Tapping an album or a button in the Android app (and mobile browsers)
  flashed a translucent blue rectangle over it — square even on pill buttons. It's gone.
  Buttons now show they're pressed in their own shape and colour: a lighter shade on the
  dark themes, a touch darker on the light ones. Albums show nothing: a tap just opens the
  album. The raised "hover" look on album tiles is kept for a mouse only, so it no longer
  sticks to the last album tapped.

## v0.3.26
- **MusicD Server is now Mandarin.** The name everywhere you see it: the page, the menu, Settings,
  sign-in, the home-screen icon's name, messages, the Android app's name, its notifications,
  widget and Android Auto, the README and the website. Nothing to do: the Docker image
  (`ghcr.io/meltface-80/musicd-server`), the container and volume names, the app's package and
  the GitHub repository keep their names, so updates, installs and your data carry on as they are.

## v0.3.25
- **A new look: Late-Night Hi-Fi**, now the default (the others stay in Settings → Setup →
  Appearance). Deep green felt with a fine texture, warm cream text and muted gold; titles in
  Young Serif, the rest in Manrope (both bundled, so the look is the same offline).
  - Home opens with **Good morning / Good afternoon / Good evening** and the date.
  - Section titles in small gold capitals; **every cover glows softly in its own colour**, on
    Home and in every album grid.
  - *Not played in 6 months* starts with a dashed gold "something unheard" tile; *Smart Picks*
    shows the reason under each pick; *Label of the week* shows the label's name large.
  - *Browse by genre*: felt cards in six earthy tones.
  - The mini player is a small receiver: the room and the format above the track
    ("This phone · Opus 256"), and the progress as a gold level meter.
  - Anyone on the old default moves to it once; a theme picked afterwards is kept.
- **Settings → Setup:** Updates moved to the bottom of the list.

## v0.3.24
- **Settings, reordered.** Account, Music Folders, Audio Devices (was Playback), Home Screen,
  Share Card, Wall Display, Downloads (in the Android app), and **Setup** — a list of its own
  for the settings set once: Away from home, Updates (was System), API Keys (was Artwork &
  metadata), Smart Picks, Discover, Appearance. Back from one of those returns to Setup.
  New icons for Audio Devices, Updates and API Keys.
- **Music Folders finds DietPi's drives and shares.** The folder picker lists every drive and
  share mounted into the server, one tap to open, and says when one can't be seen: a network
  share the machine mounts only when opened (DietPi-Drive_Manager, `x-systemd.automount`)
  never reaches a container mounted with a plain `-v /mnt:/mnt:ro`. The fix, in the README and
  docker-compose.yml: `-v /mnt:/mnt:ro,rslave`.

## v0.3.23
- **A music folder can't vanish from the library any more.** A scan used to remove every track
  it couldn't find — so a network share that dropped for a moment, or a disk slow to answer,
  could take thousands of albums with it. Now a track is removed only when the folder it was in
  was read in full and it wasn't there. A folder that couldn't be read, or most of a folder gone
  at once (over a quarter of it, and over 500 tracks), is kept as it was, and the page says so,
  with a button to remove the missing ones if you did delete them.
- **An album that comes back gets its old id back**, so play history, playlists and the phone's
  downloads find it again.
- **Settings → Music folders**, as in Roon: add any number of folders from the app — browse to
  one, tap Add — and remove them (with a Yes/No first). In Docker, mount your drives once
  (e.g. `-v /mnt:/mnt:ro`) and choose the folders inside in the app. `/music` stays the first
  folder until you change the list.
- **Android: downloaded albums play in the full MusicD page.** With the server in reach, playing
  a downloaded album (from the Downloads screen, the Home row or Android Auto) goes through the
  server to this phone like any other album — Now playing, the bar at the bottom, the queue and
  history all follow it — and the tracks still come from the phone's own files. With no server,
  it plays from the phone as before.
- **Android: the Downloaded albums row shows every download**, including one whose album the
  server doesn't have right now (it plays from the phone), and its header opens them all as a
  wall in the page rather than a separate screen.

## v0.3.22
- **Android: no more "MusicD stopped" when switching between Wi-Fi and mobile data.** On a change
  of network the app drops the page's connections on the old route; if that landed just as a new
  connection was opening, the relay tripped over the closed connection and the app stopped. It now
  just drops that connection, and the page's next request goes the new way.

## v0.3.21
- **Built-in Tailscale without pulling a new image.** Updating from *Settings → Check for updates*
  brings the server's files but not a new Docker image, so an install updated that way had no
  Tailscale engine ("Tailscale isn't in this install"). Now the server fetches the engine by itself
  when its image doesn't carry one — from the "engine" pre-release on GitHub, built for x64 and
  ARM64 on every change to main, checked against its SHA256SUMS — into the data volume, and again
  after each server update. One download (the image, once) and in-app updates are all it takes.
  The engine release is a pre-release, never "latest", so the server's updater doesn't mistake it
  for a MusicD release.
- **Downloads as a folder** (Android app). *Settings → Downloads* listed every downloaded album
  above the settings, so with ten or more the settings were out of view. The albums are now behind
  one **Downloads** folder row (how many, and the space they take). Inside: each album plays or is
  removed on its own; **Select** ticks the ones to remove (Select all / none) and removes them
  together; **Clear all** removes everything. Each asks first, Yes or No. The phone's Back steps
  out of selecting, then back to the settings.
- **A yes/no that works in the app.** The Android app answered the browser's own confirm box
  with "no" without showing it, so *Forget* on a missing music folder (v0.3.20) did nothing
  there. It, and the new Downloads questions, now use MusicD's own Yes/No dialog.
- **One place for Tailscale** (Android app): the phone's own Tailscale moves from *System* to
  *Settings → Away from home*, under *This phone*, beside the server's.
- **The app update no longer looks a version behind just after an update.** The app looks for its
  update in a file GitHub serves from a copy kept for up to five minutes — and it's asked most just
  after the server's update, when the app has only just been built. It now asks GitHub's API
  (which answers from the repository) first, and when the server is still ahead of the newest app,
  *Check for updates* says the app update is on its way rather than "Up to date".

## v0.3.20
- **Home Screen order: drag a row as far as you like, and it stays.** Holding a row's grip and
  dragging moved it one place and then stopped, and the move wasn't saved — so a row seen moved
  (Downloaded albums, say) was back where it was the next time. The row being dragged was itself
  moved about the page, and the browser gives up the drag when that happens, so the drop that
  saves never came. Now the rows around it move instead: one drag passes as many rows as you like,
  and the order is saved however the drag ends.
- **A music folder left off a new container is kept, not removed.** Re-creating the container
  without one of its `-v` lines made that folder simply not there, and the server took its albums
  out of the library (they'd come back as new albums, without their play history). A folder that's
  missing is now treated like a drive that isn't mounted: its albums stay, and Home says which
  folder is missing and how to put it back — or *Forget* it, if it's gone for good.
- *Away from home* says how to get the built-in Tailscale when the image is older than the server
  (it comes with the Docker image: `docker pull`, then re-create the container).

## v0.3.19
- **Tailscale built into the server.** One download: the Docker image now carries MusicD's own
  Tailscale engine (the same one as the Android app's). Sign in once from the new
  *Settings → Away from home* — "Sign in to Tailscale" opens Tailscale's page — and the server
  joins your tailnet by itself as **musicd**: no Tailscale on the machine it runs on, no VPN, no
  ports opened. For a headless server, `TS_AUTHKEY` signs it in instead. The pane shows its state,
  its tailnet name and address, and signs it out or switches it off.
- It serves the server's own port on the tailnet and hands each request to MusicD with the
  caller's tailnet address, so everything reached this way is *away from home* as before (only
  the phone asking plays; Opus 256; no Sonos). Phones are given this address (it comes before a
  Tailscale on the host), learned the next time the app is used at home.
- Its identity lives in the data volume (a new container is the same machine). `TAILSCALE=off`
  leaves it out; `TS_HOSTNAME` renames it. Tailscale on the host still works. The engine comes with
  the image, so it's updated with the image (Settings → Check for updates updates the server's
  files, not the engine).
- Tested with the real engine and the real server on a private tailnet: signed in, joined, and a
  second machine reached MusicD through it and was treated as away from home.

## v0.3.18
- **Cached ahead, like Plexamp** (Android app, playing on the phone). The next tracks in the queue
  — in play order, shuffle and repeat included — are kept on the phone ahead of time, so they play
  without the network: through a dead spot, or on mobile data without using any.
  *Settings → Downloads → Cached ahead*: how many on **Wi-Fi** (5 to 45, 20 unless chosen) and on
  **mobile data** (5, 10 or 15; 10 unless chosen), and the **cache size** (2, 4, 6, 8 or 10 GB;
  2 GB unless chosen). Moving from Wi-Fi to mobile data keeps what's there and fetches no further
  than the mobile number. Tracks stay until the space is needed (the ones played longest ago go
  first), so one played again is already on the phone. A line there says how many of the next
  tracks are on the phone and how much space the cache uses, with *Clear cache*.
- A track on the phone plays from there wherever you are, in the format it was kept in — one kept
  as the original at home plays as the original (Lossless on Now playing) on mobile data, using
  none. A change of queue, a skip, a new network or a new setting starts the fetching again from
  the next track.
- The player itself now holds 5 minutes / 48 MB ahead in memory (the rest is in the cache), and the
  app no longer asks Android for extra memory.

## v0.3.17
- **Settings, one column** (Android app). The first Settings screen is now a single column of
  full-width buttons — the icon first, then the name — sharing the screen's height, with no
  scrolling. Every name is the same size: the longest one decides it, as large as fits on one
  line (up to 20px), so it adjusts to the phone. Browsers and the iPhone home-screen app keep
  their two-column cards.
- "Downloads on this phone" is now just **Downloads**.

## v0.3.16
**Wi-Fi to mobile data and back, without a gap** (Android app) — what Roon Arc does, and a little more.
- **Held ahead.** The phone fetches the whole of the playing track as fast as the network allows,
  then carries on into the next one (up to 15 minutes or 96 MB), so the few seconds with no
  connection as you leave the house are played from what's already on the phone. Skipping to
  the next track is instant too.
- **Tailscale kept ready.** MusicD's own Tailscale connection now stays joined at home (idle —
  it's not used there), so when the Wi-Fi goes the way to the server is already open instead of
  starting from nothing. It ends with the app.
- **The page never moves.** MusicD's page stays on the server's home address at home and away:
  the app passes its traffic to wherever the server can be reached right now (home, its own
  Tailscale connection, or the Tailscale app). No reload when you leave or come home — nothing you
  were looking at goes, and the page keeps its settings. (The server accepts requests relayed this
  way; the WebView needs to be recent enough, otherwise the page moves as before.)
- **Quick to notice, quiet to recover.** The app reacts as soon as Android says the Wi-Fi has
  gone; a connection that has gone silent is given up on after 8 seconds instead of 20, and a
  failed fetch is tried again at once — for a minute and a half — from where it stopped, while the
  music plays on from what's held, instead of stopping and starting over.
- **Changes at the next track.** A track finishes in the format it started in: leaving the house
  mid-song keeps the original to its end (the rest fetched over Tailscale if it isn't held yet),
  and coming home mid-song keeps Opus to its end; the next track follows the new place.

**Rescan library no longer says it failed when it didn't.** The page reads MusicD Remote's words
for how a rescan went ("rebuilt", "fresh", "scanning"); this server answered in its scanner's own
("updated", "unchanged", "running"), and every one the page didn't know was shown as "Rescan
failed". The server now answers in the page's words, and the page knows both. A rescan that
finds nothing new says "Library already up to date"; one that takes longer than a few seconds
says it's scanning, then — when it's done — how many albums there are and how many new tracks.

## v0.3.15
- **One Update button for the server and the app** (Android app). The update banner and
  *Settings → System → Check for updates* now look for both — the server's update and a newer
  app — and offer them together ("v0.3.16 available for the server and this app"); one tap on
  Update starts both. The server updates and restarts by itself while the app downloads its new
  version; then Android's installer asks you to confirm, as it always must for an app that doesn't
  come from a store. Either one alone is offered the same way. The separate "Check for app update"
  button is gone; the app's version still shows in *System*.
- Browsers and the iPhone home-screen app are unchanged (server updates only). An older server
  page doesn't know about the app's updates, so the app still offers its own there.

## v0.3.14
- **What's playing, and how, on Now playing.** A badge under the album name:
  - **Lossless** for a lossless file — in the browser and the iPhone home-screen app as well as the
    Android app, and on Sonos too (hi-res goes to Sonos as 24-bit/48 kHz, still lossless).
  - **The Opus logo and 256kbps** when the Android app is playing the server's Opus 256 (away from
    home with *Stream as: Opus 256*, or an album downloaded as Opus). The phone tells the server
    which it's playing, so the badge follows a switch between home and away.
  - A lossy file names its codec ("MP3", "AAC").
  The logo is the official Opus logo (Xiph.Org's, from the Opus source tree), drawn in the badge's
  colour: the original's dark grey would disappear on this screen. Also offline, from downloads.

## v0.3.13
Two fixes from MusicD Remote (v1.8.60–v1.8.62), in the browser, the iPhone home-screen app and the
Android app alike.
- **Release date sort by the day, not the year.** The Library's date sort (now labelled *Release
  date*) ordered albums by year alone, so an album out yesterday sat among this year's by title.
  The scan now keeps each album's date as precisely as its tags state it (`DATE`/`ORIGINALDATE`:
  "2024-03-15", "2024-03" or "2024"), beside the year, which is unchanged for everything else.
  A 2011 remaster's day never lands on a 1977 original: only a tag of the album's own year refines
  it. Albums whose tags stop at the year are looked up on MusicBrainz in the background after each
  scan, newest first, twenty albums a request (MusicBrainz allows one request a second); a day is
  used only when title, artist and year all match. Within a year, an album known only to the year
  sorts after the dated ones newest-first and before them oldest-first; undated albums stay last.
  Existing libraries: the next scan (within six hours, or *Rescan library*) reads the dates of files
  it had already read, once, without a full rescan.
- **The album view shows the full release date** ("25 September 2026", written the way the device
  writes dates), the same date the sort uses; an album known only to the year is looked up as it
  opens (a second and a half at most, else it's there next time).
- **The ⋯ button is the height of Play now and Queue.** It was a 40px transparent box round a ring
  drawn inside its icon, so the ring looked about half the pills' height. The ring is now the
  button's own border at the row's height, with the pills' outline, fill, hover and press — on the
  album view and all three playlist screens.

## v0.3.12
- **Your whole library away from home** (Android app), over MusicD's own Tailscale connection — no
  Tailscale app, no VPN. Off the home Wi-Fi (5G, someone else's Wi-Fi) the app joins your tailnet
  by itself and the full MusicD page, every album and playlist, comes from the server through it;
  the server streams to the phone as Opus 256 kbps (transcoded there) or the original files — your
  choice under *Download settings → Playing away from home* (Opus 256 by default) — and only this
  phone plays (no Sonos away, as before). Back on the home Wi-Fi it switches back and the connection stops.
  Sign in once on *Settings → System → Tailscale* (formerly "Tailscale test"); a passing
  "Test connection" keeps the server address it used. If the phone isn't signed in, the old way
  (asking the Tailscale app) is still tried, and with no way through at all the offline MusicD
  (your downloads) takes over as before.
- **Downloads over mobile data**: with *Wi-Fi only* off in Download settings, downloads — yours and
  automatic ones — run on mobile data too, through the same connection. Switching it now also
  applies to downloads already waiting (before, they kept waiting for Wi-Fi).
- The connection recovers by itself after the network changes (old connections are dropped), and
  after Android has restarted the app in the background (a download or playback brings it back).

## v0.3.11
- **Always MusicD's own interface** (Android app), online, offline, no data — never a different
  screen. The app now carries a copy of the interface built from this same version, used offline
  until it has saved one from the server (then the server's own version is used), so even the
  first start with no connection is the MusicD interface rather than the old Downloads screen.
- **Losing the server while the page is open** (Wi-Fi off, walking out of range): every 15 s the
  app checks the server is still there; after two checks with no answer the offline MusicD takes
  over by itself, instead of covers going blank and the page failing.

## v0.3.10
- **No more black screen when the server can't be reached** (Android app). Away from home with no
  route to the server (the Tailscale app off, say), the page could wait a long time on a black
  screen before giving up, and a page already open lost its covers and then failed. Every load now
  checks alongside whether the server answers; if it hasn't within 3 seconds, the app's own copy of
  MusicD takes over at once (your downloads, This phone), and the page comes back from the server
  when it answers again.

## v0.3.9
- **Test build: MusicD's own Tailscale connection on the phone** (the first step of built-in
  Tailscale). The app now carries a Tailscale engine (`android/musicdnet`, Go, built into the APK
  as `libmusicdnet.so` and run as its own process, like Syncthing for Android): it joins your
  tailnet as the phone with no VPN and no Tailscale app, and opens a port on the phone that leads
  to the server. *Settings → System → Tailscale test* signs the phone in by link and tests each
  step to the server (joined, answering, seen as away, the start of a track) with timings and a
  log to copy. Nothing else uses it yet: home/away switching is unchanged. Needs the server on
  your tailnet (Tailscale on the server machine, for now). 64-bit phones only in this build.
- The engine is tested on every Android build, driven the way the app drives it, over a private
  tailnet made on the build machine (sign-in by link, forwarding, audio with ranges, held
  requests, the server going away and coming back).

## v0.3.8
- **MusicD's full interface offline** (Android app). With no connection to the server the app no
  longer drops to a minimal screen: it shows MusicD itself — Home, the album pages, the Now
  playing screen, the queue, search, artist pages, Settings — answered by the app from what's on
  the phone. The library is your downloaded albums; the one room is *This phone*; Play, Queue,
  Play next, Shuffle, the transport, seek, volume, shuffle/repeat and *play from here* all work on
  the phone's player. A line at the top says it's offline. When the server can be reached again
  (checked every 10 seconds) the page reloads from it.
- How: whenever the page loads from the server, the app keeps a copy of it (the page, its script
  and stylesheet, icons, the settings it reads) and of each downloaded album's page; offline it
  keeps the page on the server's address and answers its requests itself. So it's always the same
  interface — the same version — as the server's. Needs one visit to the server with v0.3.8 to
  make that copy; until then the app's own offline screen is used, as before.
- Things that need the server say so offline (editing albums, Sonos rooms, Smart Picks and other
  server features).

## v0.3.7
- **Settings → Downloads on this phone is a settings page like the others** (Android app): the
  same header with a back chevron to the Settings tiles, the same rows, drop-downs and switches,
  and your chosen theme. It lists the albums on the phone (cover, progress, play on this phone,
  remove — tap one to open its page), then Downloading (quality, where to save, size limit,
  Wi-Fi only) and Automatic downloads. It follows downloads as they happen. The app supplies the
  data and applies the settings; browsers and the iPhone home-screen app don't get the page.
- The app's own offline screen keeps to playing what's on the phone, with a back chevron at the
  top instead of a button at the bottom; its settings moved to the page above.

## v0.3.6
- **Downloads show up as they happen** (Android app). The Home screen's *Downloaded albums* row
  was only drawn when Home was opened, so a finished download didn't appear until the app was
  closed and opened again. The app now tells the page every time a download is queued, moves on a
  track, finishes or is removed, and the row follows at once: an album appears the moment it's
  queued, with *Queued*, *↓ 3/10*, *Waiting* or *Failed* on its cover until it's done. The row
  switches itself on with the first download, and *Settings → Home Screen* follows too.

## v0.3.5
- **Playback controls on the phone**: the phone player never handed its session to Media3's
  notification manager, so music started in the app (a download, or *This phone* from the page)
  played with no notification, no lock-screen controls — and nothing but a force-close to stop
  it. It does now, and the player also stays properly in the foreground while it plays.
- **The app's own screen offline**: when the server can't be reached the app opens the Downloads
  screen by itself — what's on the phone first, the download settings below, a *Try the server
  again* button — instead of an error page. A player bar at the bottom shows what's playing, with
  a position slider and previous / play-pause / next.
- **Crash details**: if the app stops, the next start says so and offers to share the details
  (the stack trace, the app and Android versions), so a crash can be fixed rather than guessed at.

## v0.3.4
- **The Android app updates itself** (phase 4). The server's in-app updater only ever updated the
  server, so the phone kept running the old app — which is why downloads didn't play until the
  app was reinstalled. The app now looks for a newer APK itself (GitHub's `dist/latest.json`,
  when it opens, at most hourly, and from *Settings → System → Check for app update*), downloads
  it, checks its SHA-256, and hands it to Android's installer, which installs over the top:
  sign-in and downloads stay. Android asks once to allow installs from MusicD.
- **Automatic downloads** (Downloads screen): keep today's Smart Picks, the Album of the day and
  the newest 5–30 albums on the phone, in the chosen quality, under the same Wi-Fi rule and size
  limit. Checked every six hours; albums that drop off the lists are removed again, but never
  one you downloaded yourself. New `GET /api/download/auto`.
- **Android Auto**: MusicD appears as a media app in the car — Downloaded albums (played from the
  phone), and with the server in reach Smart Picks and Random albums (played on *This phone*
  through the server, so queue and history stay the server's). A sideloaded app shows in Android
  Auto only with its developer setting *Unknown sources* on.
- Tailscale inside the app (the plan's other phase-4 item) is left out: the official Tailscale
  app already does the job, and building it in would add 20–30 MB for no gain you'd notice.

## v0.3.3
- **Settings fills the screen in the Android app**: the tiles share the screen's height, so the
  first level never scrolls; a close button replaces the backdrop, and the phone's Back button
  steps out of a pane, then out of Settings. Browsers and the iPhone home-screen app are
  unchanged (the rules are in `public/android.css`, sent to the app only).
- **Downloaded albums** Home row (Android app): the albums on this phone, first on Home; its
  title opens the Downloads screen. It starts switched off and turns itself on the first time an
  album is downloaded; while there are downloads it can't be switched off (Settings → Home Screen
  says why). Other devices don't list it.

## v0.3.2
- **Away from home** (Android, phase 3): off the home Wi-Fi the app switches to the server's
  Tailscale address — asking the Tailscale app to connect — and back again at home. The server
  learns its own Tailscale address (or `TAILSCALE_ADDRESS`) and gives it to the app; it can also
  be typed on the connect screen. A track cut off by the switch resumes where it stopped.
- **Away, only the phone plays.** The server treats any request not from the home network as
  away: it lists and reaches only the asking phone's own zone — no Sonos rooms, no pause-all,
  mute-all, grouping or moving playback to a room, and no other phone. Browsers away have nothing
  to play to. `X-Forwarded-For` is believed only from a proxy on the server itself.
- **Opus over mobile data**: away, the phone streams Opus 256 kbps (`/stream/…?q=opus`, the same
  cached files as Opus downloads), with the album's next tracks prepared ahead.
- Fix: downloaded albums played from the Downloads screen go through a file-capable data source
  (they were given to the HTTP source only).
- No "No Sonos rooms found" warning away from home.

## v0.3.1
- **Downloads** (Android, phase 2): *⋯ → Download to this phone* on an album page, as Original
  (files as they are; DSD, APE, WavPack, ALAC, AIFF and >2-channel files become lossless FLAC at
  their own rate) or Opus 256 kbps (made once with ffmpeg and cached on the server). Phone storage
  or SD card, Wi-Fi only by default, optional size limit; downloads resume after interruptions.
  A native Downloads screen lists them and plays them with no server; the app plays a downloaded
  copy instead of streaming; titles, covers and edits of downloaded albums refresh from the
  server; plays made offline are sent to the history when the server is back. Browsers and the
  iPhone home-screen app are unchanged.

## v0.3.0
- **This phone** (Android): the phone running the app is now one of the zones. Choose *This
  phone* in the room picker and albums play through the phone's speaker or headphones — Play Now,
  Queue, Next, the queue tab, now playing, shuffle/repeat, volume, play history and Random Album
  Radio all work as they do for a Sonos room, with the phone's own notification, lock screen,
  headset buttons and Android Auto (Media3). *Move what's playing* works between the phone and any
  Sonos room. Phone playback is the Android app's own: the phone zone is visible to, and
  controllable from, that phone only — never the iPhone home-screen app or a browser. A phone
  can't be grouped with Sonos rooms. It's listed while the app is open or playing.
- Audio to the phone uses the same addresses Sonos gets (FLAC up to 24/48, higher converted).

## v0.2.2
- **Android layout, second go.** v0.2.1's change (no `viewport-fit=cover` for the app) didn't
  reach the cause. The app's window now uses up the system-bar insets itself instead of passing
  them on to the WebView, and the server sends the app its stylesheet with every safe-area
  allowance at zero — so the status and navigation bars are allowed for once, by the app, however
  the WebView behaves. Browsers and the iPhone home-screen app are unchanged.

## v0.2.1
- **Android updates install over the top.** Every APK is now signed with the same key
  (`android/app/musicd-debug.keystore`); before, each build had its own, so Android refused the
  update ("package conflicts with an existing package"). Going from an older build to v0.2.1
  needs one uninstall; every update after that installs in place.
- **Android layout:** no more gap above the top buttons, the mini player sits at the bottom, and
  Now playing has its full height back so the cover shows whole. Newer Android WebViews report
  the status and navigation bars to the page, and the page left that space on top of the app's
  own — twice. The app now identifies itself and the server sends it the page without
  `viewport-fit=cover`, so the space is left once.

## v0.2.0
- **An account.** MusicD Server now has one account, kept on the server. Until it's created —
  from a device on the home network — the server only shows "Create your account". Existing
  installs ask for it straight after this update. Every device then signs in once and is
  remembered.
- **The password never crosses the network**, even over plain http: sign-in uses SRP, so the
  device proves it knows the password and the server proves it knows the account. The server
  stores only a salt and SRP verifier (the password is stretched with PBKDF2 first).
- **Settings → Account**: every signed-in device with a *Sign out* button, sign out of this
  device, and change password. Five wrong passwords from one address lock it out for 15 minutes.
- **Forgot the password:** `docker exec musicd-server node reset-password.js` removes the
  account and signs every device out; library, edits, playlists and history stay.
- **Android app** signs in (or creates the account) itself — no other device or QR code needed —
  and checks the server's proof before trusting it. If the phone is signed out from Settings, the
  app asks to sign in again.
- **Sonos keeps playing**: the audio and cover addresses speakers are given are signed, and the
  speakers' own addresses are let through, so queues made before the update still play.

## v0.1.6
- No more "No Sonos rooms found yet" while an update (or any restart) is under way. The
  speakers found last time are remembered and asked first, so rooms are back within a
  couple of seconds instead of up to 30; until the server has looked, it says it is still
  searching and the page shows nothing. "Can't reach MusicD Server" no longer flashes up
  while an update restarts the server either — only if it stays away outside an update.

## v0.1.5
- Album edits always show. An album page opened from a tile drawn before the edit (another
  row, an earlier screen, a page restored after an update) kept the old title and year,
  because the page refused the server's title when it differed from the tile's. The page
  now takes the server's current title, artist, year and cover, and asks for the write-up
  and year again under the new names.
- An edited album is found by its new names and by the ones in its files, so play history,
  what a speaker is playing and the write-ups keep finding it (and its edited year).
  A title of punctuation only, like Sigur Rós's `( )`, is found too.
- A found cover shows everywhere straight away. Anything still holding the album's old
  picture address — a tile drawn before the save, a Sonos queue from before it — now gets
  the current cover (uncached) instead of the old placeholder, and the album page swaps
  every stale tile on screen to the new cover. Re-saving to make a cover appear is no
  longer needed.
- No zooming in the browser or home-screen app: pinch and double-tap zoom are off
  (viewport, `touch-action` on every element, and iOS pinch gestures cancelled). The page
  puts itself back to 1:1 if it ever finds itself scaled, so it can't get stuck zoomed.
- Settings → Share Card → **On the card: Review** switches the write-up on the share card
  on or off (on by default).

## v0.1.4
- **Updates never lose your library or edits, and never rescan it.** After a manual or
  in-app update the whole library is there the moment the server is back and plays
  straight away; the start-up check only reads files that are new or changed.
- Album edits are also saved to `album-edits.json` in the data folder and restored from it
  if the database ever has to start over. A database that must be replaced hands over its
  edits, play history and settings first; one from a newer version is never moved aside.
- Music mounted somewhere new (e.g. `/music` → `/music/4tb`) is recognised as the same files:
  albums, ids, play history, playlists and edits stay, and nothing is re-read.
- A drive that isn't mounted (an empty mount point) keeps its albums instead of having them
  removed and re-read when it's back.
- On a first scan, albums appear and play as they're found rather than when it finishes.
- `docker-compose.yml` (and the Pages install builder) name the volume `musicd-server-data`
  explicitly, so Compose and `docker run` use the same one; the server warns, in the log
  and on screen, when `/app/data` isn't a named volume and would be lost with the container.

## v0.1.3
- **In-app updates work.** Settings → Check for updates → Update installs the newest
  release and restarts the server in place (the same updater as MusicD Remote: the
  container runs `launcher.js`, which swaps the new files in while the server is stopped).
  Every version merged to main is now published as a GitHub release for it to find.
- The image is also tagged with its version (`:0.1.3`) as well as `:latest`.

## v0.1.2
- Settings → Artwork & metadata: the saved FanArt.tv key shows as `••••` plus its
  last four characters instead of "Current: undefined"; the stale Discogs wording is gone.

## v0.1.1
- **Edit album** (album page → ⋯ → Edit album): correct the title, artist and release
  year, and find a cover for an album without one — matched on title, artist and track
  names across Apple Music, Deezer and MusicBrainz, with suggestions and a paste-an-address
  box when no match is sure. Edits live in the database and survive rescans.
- Startup no longer crashes when the data volume holds a database from another program
  (the deleted earlier project used the same volume name): it's moved aside and a fresh
  library is built.
- A warning at startup when music is mounted beside `/music` (e.g. `/music1`) instead of inside it.

## v0.1.0
- First release: local library → Sonos, 24/48 ceiling, MusicD Remote interface,
  Docker image, Android app and PWA.
