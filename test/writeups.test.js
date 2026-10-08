"use strict";
/*
 * A record's write-up and links, end to end: an album's extras (the year, the
 * day asked for there and then, Pitchfork's score with Wikipedia's words, the
 * artist's story, Qobuz's label and year, where to hear it and read about it),
 * an artist's story, Pitchfork's lists (Best New Music from its page, Latest
 * from the RSS feed when the page can't be read) and a review's match in the
 * library, the link that opens the Qobuz app, the Pitchfork part of the
 * search, and the share card's settings. Wikipedia, Qobuz's site, Pitchfork
 * and MusicBrainz are fakes on loopback. The same answers from either server;
 * behind the C# server (MANDARIN_FRONT=1), made there (v0.8.21).
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeWeb, wiki } = require("./fake-web");
const { FakeMusicBrainz } = require("./fake-musicbrainz");

const FRONT = process.env.MANDARIN_FRONT === "1";
const PORT = 3651, B = "http://127.0.0.1:" + PORT;

const ALBUM_TEXT = "Album One is the debut studio album by English band Artist A, released in 1997.";
const ARTIST_TEXT = "Artist A are an English rock band formed in London in 1990.";
const PF_BODY = "<p>Artist A made a record in a single week of 1996, with a borrowed four-track and a great deal of nerve.</p>";

test("a record's write-up and links: the same from either server", { skip: !haveFfmpeg() && "ffmpeg is not installed", timeout: 90000 }, async () => {
  const lib = makeLibrary();
  const mb = new FakeMusicBrainz([
    { id: "r1", title: "Album One", artist: "Artist A", date: "1997", tracks: [["Song 1", 2]] },
    { id: "r2", title: "Hi Res", artist: "Artist B", date: "2020-11-20", tracks: [["Hi 1", 4]] }
  ]);
  mb.failDays = true;   // Hi Res's day: found only when its page asks
  const web = new FakeWeb();
  await Promise.all([mb.start(), web.start()]);
  const W = web.base;
  const pfUrl = W + "/reviews/albums/artist-a-album-one/";
  const qzUrl = W + "/us-en/album/album-one-artist-a/abc123";
  const wikiAlbumUrl = "https://en.wikipedia.org/wiki/Album_One_(Artist_A_album)";
  const wikiArtistUrl = "https://en.wikipedia.org/wiki/Artist_A_(band)";
  Object.assign(web.pages, {
    // Pitchfork: the review (its words never shown), and the two lists.
    "/reviews/albums/artist-a-album-one/": `<html><script type="application/ld+json">{"@type":"Review","reviewBody":${JSON.stringify(PF_BODY)}}</script>` +
      `<script>x = {"musicRating":{"x":1,"score":8.4},"isBestNewMusic":true}</script></html>`,
    "/reviews/albums/": "<html>Access denied</html>",
    "/feed/feed-album-reviews/rss": `<rss><channel><item><title><![CDATA[Album One]]></title><link>https://pitchfork.com/reviews/albums/artist-a-album-one/</link>` +
      `<pubDate>Wed, 07 Oct 2026 10:00:00 +0000</pubDate><media:thumbnail url="https://media.pitchfork.com/a.jpg" width="1" /></item>` +
      `<item><title>Another &amp; One</title><link>https://pitchfork.com/reviews/albums/somebody-another-one/?utm=x</link><pubDate>Tue, 06 Oct 2026 10:00:00 +0000</pubDate></item></channel></rss>`,
    "/reviews/best/albums/": "<html><script>window.__PRELOADED_STATE__ = " + JSON.stringify({ transformed: { list: [
      { contentType: "review", url: "/reviews/albums/artist-b-hi-res/?x=1", ratingValue: { score: 9.1, isBestNewMusic: true }, dangerousHed: "<em>Hi Res</em>",
        subHed: { name: "Artist B" }, image: { sources: { lg: { url: "https://media/lg.jpg" } } }, pubDate: "2026-10-01T10:00:00.000Z" },
      { contentType: "review", url: "https://pitchfork.com/reviews/albums/artist-a-album-one/", ratingValue: { score: "8.4", isBestNewReissue: true },
        source: { hed: "*Album One*" }, subHed: { name: " Artist A " }, image: { sources: { sm: { url: "https://media/sm.jpg" } } }, pubDate: "2026-10-05T10:00:00.000Z" }
    ] } }) + ";</script></html>",
    // Qobuz's site: the search, the album's page, and the search the app's link is read from.
    "/us-en/search?q=Album%20One%20Artist%20A": `<html><a href="/us-en/album/greatest-hits-somebody/zz1">x</a><a href="/us-en/album/album-one-artist-a/abc123">Album One</a></html>`,
    "/us-en/album/album-one-artist-a/abc123": `<html><h2>Album Review: Artist A - Album One</h2><div>Artist A – Album One <p>The first record from the band, ` +
      `made in a single week with a borrowed four-track and a great deal of nerve.</p></div>\n&copy; John Smith /TiVo\nAbout the album ` +
      `<p>Released on 03/01/97 by <a href="/label/parlophone">Parlophone</a></p></html>`,
    "/gb-en/search/albums/Artist%20A%20Album%20One": `<html><a href="/fr-fr/album/album-one-artist-a/fr1"></a><a href="/gb-en/album/album-one-remastered-artist-a/rm2"></a>` +
      `<a href="/gb-en/album/album-one-artist-a/0886abc"></a></html>`,
    // Wikipedia: the album's article, the act's, and the search that ties them.
    [wiki.search("Album One Artist A album")]: wiki.hits("Album One (Artist A album)", "Artist A (band)"),
    [wiki.extract("Album One (Artist A album)")]: wiki.page("Album One (Artist A album)", ALBUM_TEXT),
    [wiki.search("Artist A band musician singer")]: wiki.hits("Artist A discography", "Artist A (band)"),
    [wiki.extract("Artist A (band)")]: wiki.page("Artist A (band)", ARTIST_TEXT),
    [wiki.search('"Artist A" "Album One"', 10)]: wiki.hits("Artist A (band)", "Album One (Artist A album)")
  });

  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    mbBaseUrl: mb.baseUrl, wikipediaBaseUrl: W, pitchforkBaseUrl: W, qobuzWebUrl: W });
  await srv.start();
  try {
    const token = await signIn(B);
    const ask = async (p, init = {}) => {
      const r = await fetch(B + "/api/" + p, Object.assign({}, init, { headers: Object.assign({ Authorization: "Bearer " + token }, init.headers || {}) }));
      if (FRONT) assert.equal(r.headers.get("x-mandarin-answered"), "C#", p + ": made by the C# server");
      return { status: r.status, headers: r.headers, body: await r.json() };
    };
    for (let i = 0; i < 150 && (await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json()).index_count !== 3; i++) await new Promise(res => setTimeout(res, 100));

    // An album's extras: Pitchfork's score and link, Wikipedia's words (Pitchfork's are never shown), Qobuz's year.
    const services = q => ["qobuz", "spotify", "apple", "amazon", "deezer", "bandcamp"].map(id => ({ id, name: { qobuz: "Qobuz", spotify: "Spotify", apple: "Apple Music",
      amazon: "Amazon Music", deezer: "Deezer", bandcamp: "Bandcamp" }[id], url: { qobuz: `https://www.qobuz.com/us-en/search/?q=${q}`, spotify: `https://open.spotify.com/search/${q}`,
      apple: `https://music.apple.com/search?term=${q}`, amazon: `https://music.amazon.com/search/${q}`, deezer: `https://www.deezer.com/search/${q}`, bandcamp: `https://bandcamp.com/search?q=${q}&item_type=a` }[id] }));
    const expected = {
      year: "1997", release_date: "1997",
      album: { description: ALBUM_TEXT, description_source: "Wikipedia", description_url: wikiAlbumUrl, year: "1997", label: null,
        url: pfUrl, source: "Pitchfork", score: 8.4, isBestNewMusic: true },
      artist: { name: "Artist A (band)", description: ARTIST_TEXT, url: wikiArtistUrl, source: "Wikipedia" },
      card: { review: true },
      links: {
        services: services("Artist%20A%20Album%20One"),
        reviews: [
          { id: "wikipedia", name: "Wikipedia", chip: "Wikipedia", kind: "album", url: wikiAlbumUrl },
          { id: "pitchfork", name: "Pitchfork", chip: "Pitchfork", kind: "album", url: pfUrl },
          { id: "allmusic", name: "AllMusic", chip: "AllMusic", kind: "album", url: "https://www.allmusic.com/search/albums/Artist%20A%20Album%20One" }
        ]
      }
    };
    let x = await ask("album/extras?title=Album%20One&artist=Artist%20A");
    assert.deepStrictEqual(x.body, expected);
    const asked = web.calls.length;
    assert.deepStrictEqual((await ask("album/extras?title=Album%20One&artist=Artist%20A")).body, expected, "again, from memory");
    assert.deepStrictEqual((await ask("album/extras?fast=1&title=Album%20One&artist=Artist%20A")).body, expected, "fast: what's kept");
    assert.equal(web.calls.length, asked, "nothing asked twice");
    assert.equal((await ask("album/extras?artist=Artist%20A")).status, 400);

    // The day, asked for there and then by the album's page (MusicBrainz answering again).
    mb.failDays = false;
    x = await ask("album/extras?fast=1&day=1&title=Hi%20Res&artist=Artist%20B");
    assert.deepStrictEqual([x.body.year, x.body.release_date, x.body.album, x.body.artist], ["2020", "2020-11-20", null, null]);

    // The artist's story.
    assert.deepStrictEqual((await ask("artist-bio?artist=Artist%20A&album=Album%20One")).body,
      { bio: { name: "Artist A (band)", text: ARTIST_TEXT, source: "Wikipedia", image: null } });
    assert.deepStrictEqual((await ask("artist-bio?artist=Nobody")).body, { bio: null });
    assert.equal((await ask("artist-bio")).status, 400);

    // Pitchfork's lists: Best New Music from its page, newest first; Latest from the feed, the artist from the address.
    const albumOneBest = { url: "https://pitchfork.com/reviews/albums/artist-a-album-one/", album: "Album One", artist: "Artist A", cover: "https://media/sm.jpg",
      score: 8.4, isBestNewMusic: true, date: "2026-10-05T10:00:00.000Z" };
    assert.deepStrictEqual((await ask("pitchfork/reviews?type=best")).body, { type: "best", items: [albumOneBest,
      { url: "https://pitchfork.com/reviews/albums/artist-b-hi-res/", album: "Hi Res", artist: "Artist B", cover: "https://media/lg.jpg", score: 9.1, isBestNewMusic: true, date: "2026-10-01T10:00:00.000Z" }] });
    const albumOneLatest = { url: "https://pitchfork.com/reviews/albums/artist-a-album-one/", album: "Album One", artist: "Artist A", cover: "https://media.pitchfork.com/a.jpg",
      score: null, isBestNewMusic: false, date: "Wed, 07 Oct 2026 10:00:00 +0000" };
    assert.deepStrictEqual((await ask("pitchfork/reviews")).body, { type: "latest", items: [albumOneLatest,
      { url: "https://pitchfork.com/reviews/albums/somebody-another-one/", album: "Another & One", artist: "Somebody", cover: null, score: null, isBestNewMusic: false, date: "Tue, 06 Oct 2026 10:00:00 +0000" }] });
    // And the search's Pitchfork part, from both lists, each review once.
    assert.deepStrictEqual((await ask("search/external?q=album%20one&parts=pitchfork")).body,
      { query: "album one", qobuz: null, qobuz_artists: null, tidal: null, tidal_artists: null, pitchfork: [albumOneLatest] });

    // A review's record in the library: by name, or by a confident search; never a guess.
    const albumOne = (await ask("library/albums?sort=album")).body.albums.find(a => a.title === "Album One");
    x = await ask("pitchfork/review?url=" + encodeURIComponent("https://pitchfork.com/reviews/albums/artist-a-album-one/") + "&album=Album%20One&artist=Artist%20A");
    assert.deepStrictEqual(x.body, { review: null, match: albumOne });
    x = await ask("pitchfork/review?url=" + encodeURIComponent("https://pitchfork.com/reviews/albums/x/") + "&album=Album&artist=Artist");
    assert.equal(x.body.match.title, "Album One");
    assert.equal(typeof x.body.match.score, "number");
    x = await ask("pitchfork/review?url=" + encodeURIComponent("https://pitchfork.com/reviews/albums/x/") + "&album=Song&artist=Artist%20A");
    assert.deepStrictEqual(x.body, { review: null, match: null }, "the artist's, but not the record");
    assert.deepStrictEqual((await ask("pitchfork/review?url=" + encodeURIComponent("https://example.com/reviews/albums/x/"))).body, { error: "Not a Pitchfork album-review URL" });
    assert.deepStrictEqual((await ask("pitchfork/review?url=nope")).body, { error: "Invalid url" });

    // The Qobuz app's link: the exact record on the storefront the language says, not the remaster or another store's.
    x = await ask("qobuz-link?album=Album%20One&artist=Artist%20A", { headers: { "Accept-Language": "en-GB,en;q=0.8" } });
    assert.deepStrictEqual(x.body, { url: "https://open.qobuz.com/album/0886abc" });
    assert.equal(x.headers.get("cache-control"), "public, max-age=604800");
    const before = web.calls.length;
    await ask("qobuz-link?album=Album%20One&artist=Artist%20A", { headers: { "Accept-Language": "en-GB" } });
    assert.equal(web.calls.length, before, "remembered");
    assert.deepStrictEqual((await ask("qobuz-link?album=Unknown&artist=Nobody")).body, { url: null });
    assert.equal((await ask("qobuz-link?artist=x")).status, 400);

    // The share card's settings: what's shown under the card, and whether the card carries the write-up.
    const J = { "Content-Type": "application/json" };
    x = await ask("settings/share-links", { method: "POST", headers: J, body: JSON.stringify({ services: ["qobuz", "nope", "bandcamp"], card_review: false }) });
    assert.deepStrictEqual(x.body, { ok: true, services: ["qobuz", "bandcamp"], reviews: ["wikipedia", "pitchfork", "allmusic"], card: { review: false } });
    x = await ask("album/extras?fast=1&title=Album%20One&artist=Artist%20A");
    assert.deepStrictEqual([x.body.card, x.body.links.services.map(s => s.id)], [{ review: false }, ["qobuz", "bandcamp"]]);
    x = await ask("settings/share-links");
    assert.deepStrictEqual(x.body.services.enabled, ["qobuz", "bandcamp"]);
    assert.equal(x.body.reviews.all.length, 5);
    assert.deepStrictEqual(x.body.reviews.all[3], { id: "wikipedia-artist", name: "Wikipedia", kind: "artist", chip: "Wikipedia artist", onByDefault: false });
    assert.equal((await ask("settings/share-links", { method: "POST", headers: J, body: "{}" })).status, 400);
  } finally { await srv.stop(); await Promise.all([mb.stop(), web.stop()]); }
});
