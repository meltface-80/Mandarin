# Album identification: fixing wrong artists, titles and track names from the library itself

**Status: built in v0.5.8** (`lib/identify/`, Settings → Setup → Identify albums), with the
owner's changes to this plan: MusicBrainz only, **no AcoustID** (§7 is not built and not
planned), and scheduling as one switch — on, a night window between the start and end times
you set; off, the scan runs continuously — rather than the bursts in §6. Wikipedia tie-breaks
(§5) are not built. Since v0.5.9 the names follow Roon's model: the album is the MusicBrainz
release group (its title, its first release year), the copy you have is one release of it
(its own date and what sets it apart — "2015 remaster" — shown beside the album, never in
its name), and editions are set aside both when searching and when scoring. The rest is as written below: a plan for a scan that finds an album's
right names from what the files already say — the artist where it is right, the album title,
the track names and, above all, the track lengths — and writes the corrections into the
server's database, without you editing albums one by one.

## 1. What the owner asked for

* Some albums show **Various Artists** (or another wrong artist) because the tags are off.
* A scan over the **whole library** that identifies each album from the artist (when right),
  album name, track names and track lengths.
* It runs in **bursts of five minutes every hour**, or in a **window of up to five hours at
  night**; the owner sets the times.
* **No API keys** for MusicBrainz "and similar". Simple methods: Wikipedia, Last.fm without an
  API, and the like.
* **95 % or better** before anything is applied. Below that the album is left **unidentified**
  and the owner matches or edits it by hand; above it the found artist, album and track names
  are applied.
* Everything goes into the server's database (the same `album_edits` overlay the album editor
  writes: the files are never touched).

## 2. What is there to use — and the one thing to say up front

| Source | Key needed? | What it gives | Track lengths? | Terms and limits |
| --- | --- | --- | --- | --- |
| **MusicBrainz** | **No.** Read-only use needs only a proper `User-Agent` | Releases with full track lists, per-track lengths in ms, artists, years, disc counts; a search that takes artist, title, track count and even durations | **Yes** | 1 request per second per IP; free, open data (CC0) |
| **AcoustID** | A free application key, obtained by registering the app once | An audio fingerprint's matching recordings (so, MusicBrainz ids) — identification with no tags at all | via MusicBrainz | Free for non-commercial use; needs `fpcalc` (Chromaprint) on the server, a Debian package |
| **Discogs** | Not for reading; a token lifts the limit (the app already has a Discogs token setting for artwork) | Releases with track lists and lengths, credits | Yes, as text | 25 requests/minute without a token, 60 with |
| **Wikipedia** | No | Album articles with a track listing, often with lengths | Sometimes, uneven | Fine for reading; pages differ wildly in shape; many albums have none |
| **Last.fm (no API)** | No | Album pages with track lists and lengths | Yes, on the page | Scraping HTML they change at will, against their terms; the API needs a key |
| **Cover Art Archive** | No | Covers by MusicBrainz release | — | Free |

The plain statement: **MusicBrainz needs no API key.** It asks only that the app names itself
(`Mandarin/0.6 (github.com/meltface-80/MusicD-Server)`) and stays under one request a
second — which a scan running in the background does anyway. It is also the only source that
answers the exact question ("a release by this artist with these N tracks of these lengths")
in structured form. This is what Picard, beets, Jellyfin, Navidrome, Lidarr and Plex all use
underneath; Roon's own database is licensed from the same kind of data. Wikipedia and Last.fm
scraping cannot reach 95 % on their own: their track listings are free text, lengths are
missing or rounded, and there is no way to ask "which album has these lengths?" — you have to
already know the album to look it up, which is the problem being solved.

So the plan: **MusicBrainz as the source, no key, one request a second, Wikipedia as a
tie-breaker for artist names only; AcoustID (a free key) as an optional extra for the albums
nothing else can identify — off unless you choose to add the key.** If you would rather have
no AcoustID at all, everything else still works; it only means a few more albums end up in
the "unidentified" pile for you.

## 3. How the tools that do this well do it

* **beets** (the reference design; open source) scores every candidate release with a
  *distance* from 0 (identical) to 1: a weighted sum over artist, album, track count, each
  track's title and length, year, media. Track lengths get no penalty within 15 s and full
  penalty at 45 s off; a missing or extra track is a heavy penalty. A candidate under
  **0.04** is a "strong" match and is applied without asking; between 0.04 and 0.15 it is
  proposed; above that, skipped. Weights: artist 3, album 3, track title 3, track length 2,
  track id 5 (fingerprint), year 1, medium/country/label small. That 0.04 is, in practice, the
  95 % the owner asked for.
* **Picard** fingerprints each file (AcoustID), asks MusicBrainz which recordings match, then
  picks the release that covers the most files with the right track count, and lets you save.
* **Jellyfin / Navidrome / Lidarr** look releases up on MusicBrainz by artist and title with
  the track count, and use lengths to pick between editions.

None of them use Wikipedia or Last.fm to identify; both are used, if at all, for write-ups
and images afterwards.

## 4. What the scan does, album by album

**Input** for one album, all from the database: the folder's artist and album-artist tags,
the album title, each track's title, number, disc number and **length in seconds** (the
library has these from the scan), the year, and the track count.

**Step 1 — is it worth looking?** An album is *suspect* when its artist is "Various Artists",
"Unknown", blank, or equal to the album title; when track titles look like `Track 01`; or when
you ask for a full pass. Everything else is checked too on a full pass, but suspect albums go
first.

**Step 2 — candidates from MusicBrainz.** One search per album:
`release?query=release:"<title>" AND tracks:<n> [AND artist:"<artist>"]` (artist only when it
is not a suspect value). The top ten candidates come back with track counts and years. For
each plausible one, one more request fetches the release with its recordings and lengths.
That is 2–6 requests an album, so **about 12 albums a minute**; a five-minute burst does
about sixty albums, a five-hour window about 3,500. The owner's 11,000 albums take a few
nights for a first full pass, then only new or changed albums are looked at.

**Step 3 — scoring** (beets' distance, ported):

| Part | Weight | Distance |
| --- | --- | --- |
| Track count | 3 | 0 if equal; 1 otherwise (an album with 12 tracks is not a 13-track edition) |
| Track lengths | 2 per track | 0 within 15 s; rising to 1 at 45 s off |
| Track titles | 3 per track | string distance after folding case, punctuation and "(feat. …)" |
| Album title | 3 | string distance, folded |
| Artist | 3 | string distance, folded — **skipped (weight 0) when the tag is a suspect value** |
| Year | 1 | 0 if equal or the tag has none |

Distance = weighted sum ÷ sum of weights, 0..1. **Applied automatically at ≤ 0.04**
(≥ 96 % similarity); **proposed at 0.04–0.15** (listed for you, one tap to accept);
**unidentified** above that or when the top two candidates are within 0.02 of each other
(an ambiguous match is never applied).

Track lengths carry the identification for the cases the owner has: a compilation tagged
"Various Artists" whose twelve tracks of 4:12, 3:58, 5:31… match one release to the second is
that release, whatever the artist tag says. Titles alone are not trusted at that level: two
editions can share every title.

**Step 4 — apply.** For an accepted match, the album gets the release's **artist** (the
release's album artist — a real compilation stays "Various Artists", now correctly), **title**
and **year**, and each track its **title** — written to `album_edits` (album level) and a new
`track_edits` overlay (per track, by the track's key), exactly as if you had used the album
editor. The files are not touched. The match is recorded (`album_matches`: MusicBrainz release
id, distance, when, applied/proposed/rejected) so a later pass does not redo it and you can
undo it. Album art is not changed by this feature.

**Step 5 — the rest.** Albums that fell in the proposed band or were unidentified are listed
under Settings → Setup → **Identify albums**, with the top candidate and its distance shown,
an **Accept** for each proposal, and **Edit** opening the album editor you have now.

## 5. Where Wikipedia and Last.fm fit

* **Wikipedia** — only as a tie-breaker for the artist *name* when MusicBrainz offers two
  spellings (the article's title is the canonical one), and later for write-ups, which the app
  already fetches from Qobuz's public pages.
* **Last.fm without the API** — not used. Their album pages would have to be scraped, which
  their terms forbid and which breaks when the page changes; and they add nothing MusicBrainz
  does not give in a stable form.

## 6. Scheduling

Settings → Setup → **Identify albums**:

* **On / off.**
* **Bursts:** five minutes every hour (the default), or two, ten, fifteen.
* **Night window:** a start and an end time (e.g. 01:00–06:00, at most five hours), instead of
  bursts. The server's own clock and `TZ` decide.
* **Run now for five minutes.**
* Progress: *3,412 of 11,064 albums checked · 3,001 applied · 214 proposed · 197 unidentified*,
  and the next run time.

The scan is one album at a time, one MusicBrainz request a second, resumable at any album:
stopping at the end of a burst costs nothing. It never runs while the library scanner is
running, and it never touches an album you edited by hand unless you ask.

## 7. Optional: fingerprints for the hard ones

For albums MusicBrainz cannot place from tags and lengths alone (no titles at all, mixed-up
folders), **AcoustID** identifies the audio itself: `fpcalc` (Chromaprint, `apt install
libchromaprint-tools`, added to the Docker image) fingerprints the first two minutes of each
track; AcoustID's lookup returns the MusicBrainz recordings for it; the release covering the
most tracks wins, scored as above with the fingerprint as a fifth weight (5). It needs one
free application key, entered in API Keys — and stays off until it is. With it, Picard-style
accuracy: nearly everything identified.

## 8. Accuracy, honestly

* On albums with real track lengths and titles, beets' 0.04 threshold is what lets it run
  unattended in many thousands of libraries; false positives at that level are rare, and the
  ambiguity rule (top two within 0.02 → unidentified) removes most of the rest.
* Where it will stay unidentified: albums MusicBrainz does not have (obscure, private, bootleg),
  box sets tagged as one album, radio rips with wrong lengths, single-track "albums".
* The first pass will produce a proposed/unidentified list of a few hundred on a library this
  size. That is the list the owner asked to edit by hand.

## 9. Phases

* **v0.6.0 — the scan, MusicBrainz, the page.** Scoring, the schedule, the `album_matches`
  and `track_edits` tables, applying artist/title/year/track titles to the overlay, the
  Identify albums page with proposals and undo. Tests against a fake MusicBrainz on loopback
  with recorded responses.
* **v0.6.1 — polish.** Wikipedia tie-breaks for artist names; per-album "identify this one
  now" from the album editor; a report of what changed.
* **v0.6.2 — AcoustID (optional).** Fingerprinting for the unidentified, off until a key is
  entered.

## 10. Questions for the owner

1. MusicBrainz with no key, one request a second — is that acceptable as "simple methods"?
   It is the one source that answers the question; without it, 95 % is not reachable.
2. AcoustID for the leftovers, if you ever want to register the one free key — worth keeping
   in the plan as optional, or leave it out entirely?
3. Track titles: apply them too (as asked), or artist/album only with the tracks proposed?
4. Albums you have already edited by hand: leave them alone (the plan's default) or check them
   as well?

## 11. Sources

* [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) and
  [rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting) — no key for
  reading; one request a second; a real User-Agent.
* beets: [configuration reference](https://beets.readthedocs.io/en/stable/reference/config.html)
  (`strong_rec_thresh` 0.04, `distance_weights`, track-length grace 15 s / max 30 s),
  [a perfect match scoring 89.9 %](https://github.com/beetbox/beets/issues/7042) (how the
  distance behaves), [auto-tagger penalty thread](https://discourse.beets.io/t/auto-tagger-penalty/913).
* Picard: [fingerprinting options](https://picard-docs.musicbrainz.org/en/v3.0/config/options_fingerprinting.html),
  [AcoustID](https://musicbrainz.org/doc/AcoustID), [Chromaprint](https://github.com/acoustid/chromaprint).
* Discogs: [API access and rate limits](https://www.discogs.com/developers/accessing.html)
  (25/min without a token, 60 with).
