"use strict";
/*
 * Pitchfork's two listings as FakeWeb pages, and a stand-in Qobuz, (test/fake-web.js), for the screens
 * contract's Pitchfork screens (test/parity.test.js, tools/quality/page-metrics.js):
 * Latest Reviews with enough reviews for the mosaic's large and small tiles, one
 * of them Best New Music, and Best New Music with its own. The newest is of the
 * fixture library's albums, so its page finds the album in the library.
 */
const review = (slug, album, artist, score, bnm, day) => ({ contentType: "review", url: "/reviews/albums/" + slug + "/",
  ratingValue: { score, isBestNewMusic: bnm }, dangerousHed: "<em>" + album + "</em>", subHed: { name: artist }, pubDate: "2026-10-" + day + "T10:00:00.000Z" });
const listing = (list) => "<html><script>window.__PRELOADED_STATE__ = " + JSON.stringify({ transformed: { list } }) + ";</script></html>";

/** The pages by path. */
function pitchforkPages() {
  return {
    "/reviews/albums/": listing([review("artist-a-album-one", "Album One", "Artist A", 8.4, false, "09"), review("artist-b-hi-res", "Hi Res", "Artist B", 9.1, true),
      review("various-best-of", "Best Of", "Various Artists", 6.8, false, "07"), review("someone-else", "Not Ours", "Someone Else", 7.2, false, "06")]),
    "/reviews/best/albums/": listing([review("artist-b-hi-res", "Hi Res", "Artist B", 9.1, true, "08")])
  };
}

/** A stand-in Qobuz for the browser's screens (item 72): two of Q Artist's albums (no covers, nothing to stream: only browsed). */
function fakeQobuz() {
  const { FakeQobuz } = require("./fake-qobuz");
  const track = (id) => ({ id, title: "Q Song " + id, file: "", duration: 3 });
  return new FakeQobuz({ albums: [
    { id: 1001, title: "Q Album", artist: "Q Artist", year: 2021, rate: 96000, bits: 24, tracks: [track(5001)] },
    { id: 1002, title: "Q Second", artist: "Q Artist", year: 2023, rate: 44100, bits: 16, tracks: [track(5002)] }
  ] });
}

module.exports = { pitchforkPages, fakeQobuz };
