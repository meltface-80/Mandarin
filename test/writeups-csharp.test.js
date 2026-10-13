"use strict";
/*
 * A record's write-up made by the C# server (v0.8.21, server/Mandarin.Server/
 * Extras/WriteUps.cs, PitchforkLists.cs) decides what the Node server's
 * decides: lib/meta.js's decisions (its `pure` part: entities and HTML, the
 * name guards, MusicBrainz's year, Qobuz's search and album pages, Wikipedia's
 * extracts and its album and artist rules, Pitchfork's review page and its
 * lists, the three sources made one), lib/wiki-match.js and
 * lib/qobuz-deeplink.js — each asked of both, the C# server through
 * `mandarin-server score`, over generated pages of every shape the code
 * reads, deepStrictEqual. The routes run against the C# server in
 * test/writeups.test.js. Skipped where the C# server isn't built.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's answers are kept
 * (test/golden.js's answers(), test/golden/writeups-csharp.json), made
 * while lib/ was here; the cases are still made here,
 * seeded, and the C# program alone is held to them case for case (the few
 * names a case is made from read through it, held the same way).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { answers } = require("./golden");

const kept = answers("writeups-csharp");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!kept.exists() && "no recording of the Node server's answers");
test.after(() => { if (!skip) kept.done(); });

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(job) + "\n", maxBuffer: 512 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
/* Each answer the Node server's (kept), the first that isn't shown with its case. */
const same = (what, cases, got) => kept.same(what, cases.map((_, i) => what + " " + i), cases, got);
/* One of the C# server's answers for each of a few names (asked as [ask], answered as [key]), held to the Node server's, as a lookup. */
function through(ask, key, names) {
  const got = csharp({ fn: "writeups", [ask]: names })[key];
  same(key + " (to make cases)", names, got);
  const map = new Map(names.map((n, i) => [n, got[i]]));
  return n => map.get(n);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r = rng(821);
const pick = list => list[Math.floor(r() * list.length)];
const maybe = (p, v) => (r() < p ? v : "");

const ARTISTS = ["The Who", "The Guess Who", "Radiohead", "Björk", "Sigur Rós", "AC/DC", "Hall & Oates", "Jay-Z", "Jay Z feat. Alicia Keys", "Airbourne",
  "Bruce Springsteen", "Simon & Garfunkel", "The National", "Kraftwerk", "Low", "Camel", "Prince", "Prince & The Revolution", "Mr. Bungle", "St. Vincent",
  "Ol' Dirty Bastard", "Kendrick Lamar", "Various Artists", "A", "The The", "Ünïcode Band", "Motörhead", "Guns N' Roses", "Crosby, Stills & Nash", "A / B",
  "X ft. Y", "Earth, Wind & Fire", "Sting", "The Beatles", "Beatles"];
const TITLES = ["Kid A", "OK Computer", "Western Stars", "Airbourne", "Runnin' Wild", "( )", "Up", "Low", "IV", "Songs About New York", "good kid, m.A.A.d city",
  "Rattle And Hum", "Mezzanine", "Greatest Hits", "The Wall", "Ænima", "Who's Next", "Tales From Topographic Oceans", "Born in the U.S.A.", "1999",
  "Rumours (Super Deluxe)", "Blue Rev", "Hail to the Thief", "Mezzanine (Remastered)", "Ünïcode Record", "The Who Sell Out", "Live / Dead", "Kid A Mnesia (Kid A)"];
const WS = [" ", "  ", "\t", "\n", " ", " ", "\r\n", ""];
const DASHES = ["-", "–", "—", "~"];
const CASE = s => r() < 0.3 ? s.toUpperCase() : r() < 0.3 ? s.toLowerCase() : s;

const ENTITIES = ["&amp;", "&AMP", "&#169;", "&#xA9", "&#x1F600;", "&#55296;", "&#1114112;", "&#x110000;", "&#0;", "&nbsp;", "&hellip", "&unknown;",
  "&constructor;", "&a1;", "&#xffffffffffffffffff;", "&#99999999999999999999;", "&;", "&#;", "&#x;", "&lt;b&gt;", "&quot;", "&apos;", "&mdash;", "&Copy;",
  "&RSQUO;", "&deg", "&lsquo;x&rsquo;", "&#039;", "&#X41;", "&#65", "&amp;amp;"];
function textBit() {
  return pick([pick(ARTISTS), pick(TITLES), pick(ENTITIES), pick(WS), "word", "Ünï", "😀", "a.b", "x y", "café", "ﬁne", "2001", "—", "/", "&", "<", ">"]);
}
function text(n) { let s = ""; for (let i = 0; i < n; i++) s += textBit(); return s; }
const TAGS = ["<script>var x = '<p>';</script>", "<SCRIPT type='x'>a</SCRIPT>", "<style>p{}</style>", "<STYLE>q</style>", "<br>", "<BR/>", "<br />", "<br\t/ >",
  "<p>", "</P>", "<p class='x'>", "<pre>", "<picture>", "<a href=\"x\">", "</a>", "<em>", "<!-- c -->", "<div\n class=x>", "<", ">", "<script>never closed"];
function html(n) { let s = ""; for (let i = 0; i < n; i++) s += r() < 0.4 ? pick(TAGS) : text(1 + Math.floor(r() * 3)); return s; }

test("text: entities, HTML, the name guards, slugs, titles", { skip }, () => {
  const decode = [...ENTITIES, ...Array.from({ length: 400 }, () => text(1 + Math.floor(r() * 6))), "", null, 0, 5];
  const strip = [...Array.from({ length: 600 }, () => html(1 + Math.floor(r() * 12))), "", null];
  const names = [...ARTISTS, ...TITLES, ...Array.from({ length: 200 }, () => text(1 + Math.floor(r() * 4))), "", null, 0, "the", "a b", "an"];
  const leads = [...Array.from({ length: 400 }, () => pick(WS) + pick([...ARTISTS, text(2)]) + pick([" ", "\t", "  "]) + pick(DASHES) + pick([" ", " ", "\n"]) + text(2)), "", null,
    "ab - c", "a - c", "x".repeat(61) + " - y", "x".repeat(60) + " - y"];
  const titles = [...TITLES, "Camel (band)", "Low (David Bowie album)", "A (b) (c)", "(only)", " Pang (album) ", "X (y) z", "", null, ...Array.from({ length: 100 }, () => text(2) + pick([" (", "("]) + text(1) + ")" + pick(WS))];
  const pairs = [];
  for (let i = 0; i < 600; i++) pairs.push([pick(names), pick(names)]);
  pairs.push(["The Verve", "Verve"], ["the who", "The Guess Who"], ["Jay Z", "jay z feat alicia keys"], [null, "x"], ["", ""]);
  const pageTitles = [];
  for (let i = 0; i < 600; i++) pageTitles.push([pick(TITLES.concat(names)), pick(titles.concat(TITLES.map(t => t + " (" + pick(ARTISTS) + " album)")))]);
  const job = { fn: "writeups", normalize: names, decode, strip, first: names, lead: leads, slug: names.concat(["Don't Stop", "Don’t Stop", "--a--", "a  b"]), title_base: titles, pairs, page_titles: pageTitles };
  const got = csharp(job);
  same("normalize", names, got.normalize);
  same("decode", decode, got.decode);
  same("strip", strip, got.strip);
  same("first", names, got.first);
  same("lead", leads, got.lead);
  same("slug", job.slug, got.slug);
  same("title_base", titles, got.title_base);
  same("disambiguator", titles, got.disambiguator);
  same("loose", pairs, got.loose);
  same("overlap", pairs, got.overlap);
  same("page_title", pageTitles, got.page_title);
});

/* Qobuz's slugs, as it files an album: lower case, hyphens, its own idea of punctuation. */
const qslug = s => String(s).toLowerCase().replace(/['.]/g, "").replace(/[^a-z0-9ü]+/g, "-").replace(/^-|-$/g, "");
function qobuzSearchPage(title, artist) {
  let s = "<html><body>";
  for (let k = Math.floor(r() * 8); k > 0; k--) {
    const t = r() < 0.5 ? title : pick(TITLES), a = r() < 0.6 ? artist : pick(ARTISTS);
    const slug = r() < 0.5 ? qslug(t) + "-" + qslug(a) : qslug(a) + "-" + qslug(t) + maybe(0.3, "-deluxe");
    const id = pick(["abc123", "0886447", "x9", "ABc12", "zz", "1"]) + Math.floor(r() * 9);
    s += `<a href="${pick(["/us-en", "/gb-en", "", "https://www.qobuz.com/us-en"])}/album/${slug}/${id}">${t}</a>` + pick(WS);
    if (r() < 0.1) s += `<a href='/us-en/album/${slug} odd/${id}'>`;
  }
  return s + "</body></html>";
}
function qobuzAlbumPage(title, artist) {
  const headArtist = r() < 0.75 ? CASE(artist) : pick(ARTISTS);
  let s = "<html>" + maybe(0.3, "<p>Album Review mentioned early</p>") + "<h2>" + pick(["Album Review: ", "Album Review ", "ALBUM REVIEW:", "Album Review:\n"]) +
    maybe(0.8, headArtist + " " + pick(DASHES) + " " + title) + "</h2>";
  s += "<div>" + maybe(0.5, pick(WS) + CASE(pick([artist, headArtist])) + pick([" ", "\t", ""]) + pick(DASHES) + pick([" ", "  ", ""]) + CASE(title) + pick(WS)) +
    "<p>" + text(r() < 0.3 ? 3 : 25) + "</p>" + html(2) + "</div>";
  s += pick(["", "\n© John Smith /TiVo", "\n&copy; Jane Doe /AllMusic", "\nReview by Somebody Else", "\n© x /Qobuz  ", "\n© no slash"]);
  s += pick(["About the album", "Improve album information", "Why buy on Qobuz", "", "x".repeat(9000)]);
  if (r() < 0.8) s += ` Released on ${pick(["03/04/80", "12/31/08", "1/2/2001", "2015", "07/07/" + String((new Date().getFullYear() + 1) % 100).padStart(2, "0"), "1/2/"])} ${pick(["by", "BY"])} <a href="/label/x">${pick([" Blue Note ", "ECM", "", "  "])}</a>`;
  return s + "</html>";
}

test("Qobuz: the search's album, and what its page says", { skip }, () => {
  const searches = [], pages = [];
  for (let i = 0; i < 500; i++) {
    const title = pick(TITLES), artist = r() < 0.1 ? "" : pick(ARTISTS);
    searches.push([qobuzSearchPage(title, artist), title, artist]);
    pages.push([qobuzAlbumPage(title, artist), title, r() < 0.1 ? "" : artist, "https://www.qobuz.com/us-en/album/x/" + i]);
  }
  searches.push(["", "Kid A", "Radiohead"], ["<a href=\"/album/kid-a-radiohead/abc\">", "Kid A", ""]);
  const got = csharp({ fn: "writeups", qobuz_search: searches, qobuz_pages: pages });
  same("qobuz_pick", searches, got.qobuz_pick);
  same("qobuz_page", pages, got.qobuz_page);
});

const LEADS = [
  t => `${t} is the third studio album by ${pick(ARTISTS)}, released in ${1970 + Math.floor(r() * 50)}.`,
  t => `${t} was a record made in 1999 by the band.`,
  () => `${pick(ARTISTS)} (born 3 March 1970) is an American singer.`,
  () => `${pick(ARTISTS)} (1943–2001) was an English guitarist.`,
  () => `${pick(ARTISTS)} is a British band formed in 1985.`,
  t => `${t} is a 2019 documentary film.`,
  t => `"${t}" is a song. It was released as a single.`,
  () => `${pick(ARTISTS)} may refer to: a band; a place.`,
  () => `${pick(ARTISTS)} are an English rock band. Their recording artist career began.`,
  t => text(4) + " " + t + " " + text(4)
];
function extractData() {
  const pages = {};
  for (let k = 1 + Math.floor(r() * 3); k > 0; k--) {
    const id = pick(["123", "-1", "9", "0", "abc", "42"]);
    const title = pick(TITLES) + maybe(0.4, " (" + pick(ARTISTS) + " album)");
    pages[id] = r() < 0.1 ? null : { pageid: Number(id) || 0, title, extract: r() < 0.15 ? "" : pick(LEADS)(title), fullurl: r() < 0.3 ? undefined : "https://en.wikipedia.org/wiki/" + encodeURIComponent(title) };
  }
  return pick([{ query: { pages } }, { query: { pages } }, { query: {} }, {}, { query: { pages: "x" } }, null]);
}

test("Wikipedia: the extract, the album rule, the artist rules", { skip }, () => {
  const extracts = Array.from({ length: 400 }, extractData);
  const wikiAlbums = [];
  for (let i = 0; i < 800; i++) {
    const title = pick(TITLES), artist = r() < 0.15 ? "" : pick(ARTISTS);
    const pageTitle = pick([title, title + " (" + artist + " album)", pick(TITLES) + " (" + title + " album)", title + " (album)", pick(TITLES)]);
    wikiAlbums.push([pageTitle, { title: pageTitle, description: pick(LEADS)(r() < 0.7 ? title : pick(TITLES)).replace("the band", r() < 0.5 ? artist : "someone"), url: "u" }, title, artist]);
  }
  const artistNames = [...ARTISTS, "A / B / C", "AC/DC", "Crosby, Stills, Nash", " Low ", "x,y"];
  const primaryOf = through("artist_names", "artist_primary", artistNames);
  const artistTitles = [];
  for (let i = 0; i < 600; i++) {
    const primary = primaryOf(pick(artistNames));
    artistTitles.push([pick([primary, primary + " (band)", primary + " (musician)", primary + " (disambiguation)", primary + " discography", "The " + primary, pick(ARTISTS), primary + " (album)", undefined]), primary]);
  }
  const artistExtracts = Array.from({ length: 400 }, () => ({ title: "t", description: pick(LEADS)(pick(TITLES)) + maybe(0.3, " " + text(3)), url: "u" }));
  const got = csharp({ fn: "writeups", extracts, wiki_albums: wikiAlbums, artist_names: artistNames, artist_titles: artistTitles, artist_extracts: artistExtracts });
  same("extract", extracts, got.extract);
  same("wiki_album", wikiAlbums, got.wiki_album);
  same("artist_primary", artistNames, got.artist_primary);
  same("artist_title", artistTitles, got.artist_title);
  same("artist_extract", artistExtracts, got.artist_extract);
});

function pitchforkPage(artist) {
  let s = "<html><head>";
  for (let k = Math.floor(r() * 3); k > 0; k--) {
    const body = r() < 0.7 ? (r() < 0.6 ? artist + " " : "") + text(6) + html(2) : "";
    const obj = pick([{ "@type": "Review", reviewBody: body }, { "@type": "WebPage" }, { "@type": "Review" }, [{ "@type": "Review", reviewBody: "x" }], null, { "@type": "Review", reviewBody: 5 }]);
    const json = r() < 0.1 ? "{not json" : JSON.stringify(obj);
    s += `<${pick(["script", "SCRIPT"])} ${pick(["type", "TYPE"])}=${pick(["\"", "'"])}application/ld+json${pick(["\"", "'"])}${maybe(0.3, " id=x")}>${json}</${pick(["script", "Script"])}>`;
  }
  if (r() < 0.7) s += `"musicRating"${pick(WS)}:${pick(WS)}{"x":1,"score"${pick(WS)}:${pick(WS)}${pick(["8.5", "10", "7", "0.3", "1".repeat(400), "abc"])}}`;
  if (r() < 0.7) s += `"isBestNewMusic"${pick(WS)}:${pick(WS)}${pick(["true", "false", "TRUE"])}`;
  return s + "</head></html>";
}

test("Pitchfork: a review page's score and Best New Music, and whose review it is", { skip }, () => {
  const pages = [], verdicts = [], artists = [];
  const pfPrimary = through("pf_artists", "pf_primary", ARTISTS);
  for (let i = 0; i < 500; i++) {
    const artist = pick(ARTISTS);
    const page = pitchforkPage(artist);
    pages.push(page);
    artists.push(pick([artist, artist + " feat. X", artist + " / B", artist + ", C", artist + " & D", " " + artist + " ", "", null]));
    verdicts.push([page, pfPrimary(pick(ARTISTS)), "https://pitchfork.com/reviews/albums/x-" + i + "/"]);
  }
  const got = csharp({ fn: "writeups", pf_pages: pages, pf_artists: artists, pf_verdicts: verdicts });
  same("pf_parse", pages, got.pf_parse);
  same("pf_primary", artists, got.pf_primary);
  same("pf_verdict", verdicts, got.pf_verdict);
});

test("the three sources made one: the write-up shown, its source and link, the artist's story, every page found", { skip }, () => {
  const desc = () => pick([null, "", text(8), pick(ARTISTS) + " - " + pick(TITLES) + " " + text(5), "&amp; " + text(4) + " &#169;", "  " + text(3) + "  "]);
  const combines = [];
  for (let i = 0; i < 1500; i++) {
    const pf = pick([null, null, { description: desc(), score: pick([8.1, null, 10]), isBestNewMusic: pick([true, false]), url: "https://pitchfork.com/x", source: "Pitchfork" }, { description: null, score: 7 }]);
    const qz = pick([null, { description: desc(), year: pick(["1999", null, ""]), label: pick(["ECM", null]), url: pick(["https://qobuz/x", null]), source: "Qobuz" }, { year: "2001", label: "X" }]);
    const wk = pick([null, { album: pick([null, { title: "t", description: desc(), url: pick(["https://w/a", null]), source: "Wikipedia" }]), artist: pick([null, { name: pick(["N", null, ""]), description: "d", url: pick(["https://w/b", null]) }]) },
      { album: { description: "Released 1987 and 1999" } }]);
    combines.push([pf, qz, wk, pick([pick(ARTISTS), "", null])]);
  }
  const got = csharp({ fn: "writeups", combines });
  same("combine", combines, got.combine);
});

function reviewNode(i) {
  const url = pick(["/reviews/albums/" + qslug(pick(ARTISTS)) + "-" + qslug(pick(TITLES)) + "/", "https://pitchfork.com/reviews/albums/x-" + i + "/?ref=a#b", "/reviews/albums/dup/", 7]);
  return {
    contentType: pick(["review", "review", "news"]), url, ratingValue: pick([{ score: pick(["8.4", 9, "", null, "x", { a: 1 }]), isBestNewMusic: pick([true, false, 1, 0]), isBestNewReissue: pick([true, false]) }, 5, null, {}]),
    dangerousHed: pick(["<em>" + pick(TITLES) + "</em>", "", 5, "<b></b>", pick(TITLES) + " &amp; more"]), source: pick([{ hed: "*" + pick(TITLES) + "*" }, "src", null, { hed: 5 }]),
    subHed: pick([{ name: " " + pick(ARTISTS) + " " }, { name: 5 }, "x", null]),
    image: pick([{ sources: { lg: { url: "lg" + i }, sm: { url: "sm" } } }, { sources: { xxl: { url: "" }, md: { url: "md" } } }, { sources: "x" }, null, "img", { sources: [] }]),
    pubDate: pick(["2026-10-0" + (1 + (i % 9)) + "T00:00:00Z", "", null, 20261001])
  };
}
function stateOf(n) {
  const root = { transformed: { review: { listing: [] } }, other: [] };
  for (let i = 0; i < n; i++) {
    const where = pick([root.transformed.review.listing, root.other]);
    where.push(r() < 0.2 ? [reviewNode(i), "s", 3] : r() < 0.2 ? { wrap: reviewNode(i), "10": reviewNode(i + 1000), "2": "x" } : reviewNode(i));
  }
  root.braces = "a { b } \" c";
  return root;
}

test("Pitchfork's lists: the listing's state, the RSS feed, the artist from an address, newest first, the search", { skip }, () => {
  const listings = [];
  for (let i = 0; i < 200; i++) {
    const json = JSON.stringify(stateOf(Math.floor(r() * 12)));
    listings.push(pick([`<script>window.__PRELOADED_STATE__ = ${json};</script>`, `x__PRELOADED_STATE__=${json}`, `__PRELOADED_STATE__ ${json.slice(0, json.length - 1)}`,
      "no state here", `__PRELOADED_STATE__ = {"a": "\\"}", "b": {"c": 1}}`, `__PRELOADED_STATE__ = {bad json}`]));
  }
  const rss = [];
  for (let i = 0; i < 150; i++) {
    let x = "<rss><channel>";
    for (let k = Math.floor(r() * 6); k > 0; k--) {
      x += `<${pick(["item", "ITEM", "item "])}>` + `<link>${pick(["<![CDATA[https://pitchfork.com/reviews/albums/" + qslug(pick(ARTISTS)) + "-" + qslug(pick(TITLES)) + "/?a=1]]>", "https://pitchfork.com/news/x", "", " https://pitchfork.com/reviews/albums/y/#c "])}</link>` +
        maybe(0.9, `<title>${pick(["<![CDATA[" + pick(TITLES) + "]]>", "&lt;em&gt;" + pick(TITLES) + "&lt;/em&gt;", "", pick(TITLES) + " &amp; X"])}</title>`) +
        maybe(0.7, `<media:thumbnail ${pick(["", "width=\"1\" "])}url=${pick(["\"https://c/" + k + ".jpg\"", "'https://c/x.jpg'"])} />`) +
        maybe(0.8, `<pubDate>${pick(["Wed, 07 Oct 2026 10:00:00 +0000", "<![CDATA[ Tue, 06 Oct 2026 ]]>", ""])}</pubDate>`) + `</${pick(["item", "Item"])}>`;
    }
    rss.push(x + "<items>not one</items></channel></rss>");
  }
  const slugOf = through("slug", "slug", TITLES);
  const reviewUrls = Array.from({ length: 200 }, () => {
    const t = pick(TITLES);
    return [pick(["https://pitchfork.com/reviews/albums/" + qslug(pick(ARTISTS)) + "-" + slugOf(t) + "/", "/reviews/albums/" + slugOf(t) + "/", "https://pitchfork.com/news/x", "", null, "/reviews/albums/-a--b/?x"]), pick([t, "", null])];
  });
  const items = Array.from({ length: 200 }, (_, i) => ({ url: "u" + i, album: pick(["", "A", null, 0]), artist: pick([null, "", "B"]), cover: pick([null, "", "c"]), score: pick([null, undefined, 0, 7.5]), isBestNewMusic: pick([0, 1, true, null]), date: pick([null, "", "d"]) }));
  const sorts = Array.from({ length: 100 }, () => Array.from({ length: Math.floor(r() * 8) }, (_, i) => ({ url: "u" + i, date: pick(["2026-10-01T00:00:00Z", "2026-10-02", "", null, "Wed, 07 Oct 2026", 5, "2025-12-31T23:59:59Z"]) })));
  const lists = () => Array.from({ length: Math.floor(r() * 10) }, (_, i) => ({ url: "u" + Math.floor(r() * 12), album: pick(TITLES), artist: pick([pick(ARTISTS), null, ""]) }));
  const matches = Array.from({ length: 200 }, () => [lists(), lists(), pick(["kid", "The", "", "radio", "ünï", "a", "who sell", null]), pick([6, 1, 3])]);
  const got = csharp({ fn: "writeups", listings, rss, review_urls: reviewUrls, items, sorts, matches });
  same("state", listings, got.state);
  same("listing", listings, got.listing);
  same("rss", rss, got.rss);
  same("from_url", reviewUrls, got.from_url);
  same("item_out", items, got.item_out);
  same("newest", sorts, got.newest);
  same("match", matches, got.match);
});

test("MusicBrainz's year, and the Qobuz app's link", { skip }, () => {
  const years = Array.from({ length: 300 }, () => ({ "release-groups": Array.from({ length: Math.floor(r() * 6) }, () => (
    { "first-release-date": pick(["1977-02-04", "1977", "", "2011-09-26", "1999-12", "abc", undefined, "0000", "99"]) })) }));
  years.push({}, { "release-groups": [] });
  const canon = [...ARTISTS, ...TITLES, "AC/DC", "Ol' Dirty Bastard", "good kid, m.A.A.d city", "Ünïcode", "", null, 7];
  const albumIds = [];
  for (let i = 0; i < 400; i++) {
    const album = pick(TITLES), artist = pick([pick(ARTISTS), "", null]);
    const store = pick(["gb-en", "us-en", "fr-fr"]);
    let page = "";
    for (let k = Math.floor(r() * 6); k > 0; k--) {
      const slug = pick([qslug(album) + "-" + qslug(artist || ""), qslug(album) + "-remastered-" + qslug(artist || ""), qslug(pick(TITLES)) + "-" + qslug(pick(ARTISTS)), qslug(album)]);
      page += `<a href="/${pick([store, store, "de-de"])}/album/${slug}/${pick(["Ab12", "0886", "x"])}${k}">` + pick(WS);
    }
    albumIds.push([page, store, artist, album]);
  }
  albumIds.push(["", "gb-en", "x", ""], [null, "gb-en", "a", "b"]);
  const got = csharp({ fn: "writeups", years, canon, album_ids: albumIds });
  same("year", years, got.year);
  same("canon", canon, got.canon);
  same("album_id", albumIds, got.album_id);
});
