// ExtrasCommand.cs — the pure parts of v0.8.20's ports asked directly, through
// `mandarin-server score` (Identify/ScoreCommand.cs), a line of JSON in and a
// line out, so the tests hold them to the Node server's (test/extras-csharp.test.js):
//
//   { fn: "share", cases: [{ artist, album, locale, accept, enabled, reviews, wikipedia, pitchfork, wikipedia_artist, ids }] }
//   { fn: "similar", names, overlaps, artists, related, pools, years, tops, album_lists, tastes, ranks, chooses, reasons, records, played }
//   { fn: "days", titles, batches: [{ albums: [{ key, title, artist, year, date }], groups }] }
//   { fn: "labels", plain: [...], images: [{ b64, type }] }
//   { fn: "writeups", … } and { fn: "blob", texts, ints, uris, entries, docs, date, version, encodes, decodes } (v0.8.21)
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static class ExtrasCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static string? S(object? v) => v as string;
    private static List<string>? Ids(object? v) => v is List<object?> l ? l.OfType<string>().ToList() : null;

    public static JsObj Run(string fn, JsObj job) => fn switch
    {
        "share" => Share(job),
        "similar" => SimilarFns(job),
        "days" => Days(job),
        "labels" => LabelFns(job),
        "writeups" => WriteUpFns(job),
        "blob" => BlobFns(job),
        _ => throw new JsError("unknown fn")
    };

    /* lib/server/share.js's: its fields, a track's entry, a whole document (on the date and version given), blobs made, pastes read. */
    private static JsObj BlobFns(JsObj job)
    {
        var o = new JsObj();
        o["text"] = Each(job["texts"], a => ShareBlob.Text(Arg(a, 0), (int)Js.ToNumber(Arg(a, 1))));
        o["int"] = Each(job["ints"], a => ShareBlob.Int(Arg(a, 0), Js.ToNumber(Arg(a, 1)), Js.ToNumber(Arg(a, 2))));
        o["uris"] = Each(job["uris"], ShareBlob.UriList);
        o["entry"] = Each(job["entries"], ShareBlob.TrackEntry);
        o["doc"] = Each(job["docs"], d0 =>
        {
            var d = O(d0);
            var (doc, count, skipped, truncated) = ShareBlob.BuildDoc(d["name"], d["annotation"], d["tracks"], Str(job["date"]), Str(job["version"]));
            var x = new JsObj();
            x["doc"] = doc;
            x["track_count"] = (double)count;
            x["skipped"] = (double)skipped;
            x["truncated"] = truncated;
            return x;
        });
        o["encoded"] = Each(job["encodes"], d => ShareBlob.Encode(O(d)));
        o["decoded"] = Each(job["decodes"], b =>
        {
            var x = new JsObj();
            try { x["doc"] = ShareBlob.Decode(Str(b)); }
            catch (ShareBlob.Refused e) { x["error"] = e.Message; }
            return x;
        });
        return o;
    }

    private static List<object?> Each(object? list, Func<object?, object?> f) => L(list).Select(f).ToList();
    private static object? Arg(object? args, int i) { var l = L(args); return i < l.Count ? l[i] : Undef.V; }
    private static string Str(object? v) => Js.IsNullish(v) ? "" : Js.Str(v);
    private static List<object?> Items(IEnumerable<JsObj> items) => items.Select(x => (object?)x).ToList();

    /* lib/meta.js's decisions (its `pure`), lib/wiki-match.js's and lib/qobuz-deeplink.js's: each asked with the same arguments. */
    private static JsObj WriteUpFns(JsObj job)
    {
        var o = new JsObj();
        o["normalize"] = Each(job["normalize"], WriteUps.Normalize);
        o["decode"] = Each(job["decode"], x => WriteUps.DecodeEntities(x));
        o["strip"] = Each(job["strip"], x => WriteUps.StripHtml(x));
        o["first"] = Each(job["first"], x => WriteUps.FirstSignificantToken(x));
        o["lead"] = Each(job["lead"], x => WriteUps.LeadArtistOf(x));
        o["slug"] = Each(job["slug"], x => WriteUps.SlugifyForPitchfork(x));
        o["title_base"] = Each(job["title_base"], x => WriteUps.WikiTitleBase(x));
        o["loose"] = Each(job["pairs"], a => WriteUps.NamesEqualLoose(Arg(a, 0), Arg(a, 1)));
        o["overlap"] = Each(job["pairs"], a => WriteUps.NamesOverlap(Arg(a, 0), Arg(a, 1)));
        o["disambiguator"] = Each(job["title_base"], x => WriteUps.StripDisambiguator(x));
        o["page_title"] = Each(job["page_titles"], a => WriteUps.AlbumPageTitleMatches(Arg(a, 0), Arg(a, 1)));
        o["year"] = Each(job["years"], j => WriteUps.PickAlbumYear(j));
        o["qobuz_pick"] = Each(job["qobuz_search"], a =>
        {
            if (WriteUps.QobuzPick(Str(Arg(a, 0)), Arg(a, 1), Arg(a, 2)) is not { } p) return null;
            var x = new JsObj();
            x["slug"] = p.Slug;
            x["id"] = p.Id;
            return x;
        });
        o["qobuz_page"] = Each(job["qobuz_pages"], a => WriteUps.QobuzAlbumPage(Str(Arg(a, 0)), Arg(a, 1), Arg(a, 2), Str(Arg(a, 3))));
        o["extract"] = Each(job["extracts"], d => WriteUps.WikiExtractOf(d));
        o["wiki_album"] = Each(job["wiki_albums"], a => WriteUps.WikiAlbumAccepts(Arg(a, 0), O(Arg(a, 1)), Arg(a, 2), Arg(a, 3)));
        o["artist_primary"] = Each(job["artist_names"], n => WriteUps.WikiArtistPrimary(Str(n)));
        o["artist_title"] = Each(job["artist_titles"], a => WriteUps.WikiArtistTitleOk(Arg(a, 0), Str(Arg(a, 1))));
        o["artist_extract"] = Each(job["artist_extracts"], e => WriteUps.WikiArtistExtractOk(O(e)));
        o["pf_parse"] = Each(job["pf_pages"], h =>
        {
            var (d, sc, bnm) = WriteUps.ParsePitchforkReviewHtml(Str(h));
            var x = new JsObj();
            x["description"] = d;
            x["score"] = sc;
            x["isBestNewMusic"] = bnm;
            return x;
        });
        o["pf_primary"] = Each(job["pf_artists"], a => WriteUps.PitchforkPrimary(a));
        o["pf_verdict"] = Each(job["pf_verdicts"], a => WriteUps.PitchforkVerdict(Str(Arg(a, 0)), Str(Arg(a, 1)), Str(Arg(a, 2))));
        o["combine"] = Each(job["combines"], a => WriteUps.CombineBios(Arg(a, 0), Arg(a, 1), Arg(a, 2), Arg(a, 3)));
        o["rss"] = Each(job["rss"], x => Items(PitchforkLists.ParseRss(Str(x))));
        o["state"] = Each(job["listings"], h => PitchforkLists.ExtractPreloadedState(Str(h)));
        o["listing"] = Each(job["listings"], h => Items(PitchforkLists.ListingItems(Str(h))));
        o["from_url"] = Each(job["review_urls"], a => PitchforkLists.ArtistFromReviewUrl(Arg(a, 0), Arg(a, 1)));
        o["item_out"] = Each(job["items"], x => PitchforkLists.ItemOut(O(x)));
        o["newest"] = Each(job["sorts"], l => Items(PitchforkLists.NewestFirst(L(l).Select(O))));
        o["match"] = Each(job["matches"], a => Items(PitchforkLists.Match(L(Arg(a, 0)).Select(O).ToList(), L(Arg(a, 1)).Select(O).ToList(), Arg(a, 2), (int)Js.ToNumber(Arg(a, 3)))));
        o["canon"] = Each(job["canon"], x => WriteUps.Canon(x));
        o["album_id"] = Each(job["album_ids"], a => WriteUps.PickAlbumId(Arg(a, 0), Str(Arg(a, 1)), Arg(a, 2), Arg(a, 3)));
        return o;
    }

    private static JsObj Share(JsObj job)
    {
        var o = new JsObj();
        o["share"] = L(job["cases"]).Select(c0 =>
        {
            var c = O(c0);
            var x = new JsObj();
            x["primary"] = ShareLinks.PrimaryArtist(c["artist"]);
            x["query"] = ShareLinks.SearchQuery(c["artist"], c["album"]);
            x["storefront"] = ShareLinks.QobuzStorefront(c["locale"]);
            x["locale"] = ShareLinks.LocaleFromAcceptLanguage(S(c["accept"]));
            x["services"] = ShareLinks.ServiceLinks(c["artist"], c["album"], S(c["locale"]), Ids(c["enabled"]));
            x["reviews"] = ShareLinks.ReviewLinks(c["artist"], c["album"], Ids(c["reviews"]), S(c["wikipedia"]), S(c["pitchfork"]), S(c["wikipedia_artist"]));
            x["services_kept"] = ShareLinks.SanitiseIds(c["ids"], ShareLinks.KnownServiceIds()).Select(i => (object?)i).ToList();
            x["reviews_kept"] = ShareLinks.SanitiseIds(c["ids"], ShareLinks.KnownReviewIds()).Select(i => (object?)i).ToList();
            return (object?)x;
        }).ToList();
        return o;
    }

    /* An act as rankActs returns it: the pool's fields, then what the ranking adds. */
    private static JsObj ActJson(Act a)
    {
        var o = a.PoolJson();
        o["score"] = a.Score;
        o["known"] = a.Known;
        o["near"] = a.Near;
        o["via"] = a.Via.Select(v => (object?)v).ToList();
        return o;
    }
    private static Act ActOf(object? v)
    {
        var o = O(v);
        var a = Act.FromPool(o);
        a.Score = o.Has("score") ? Js.ToNumber(o["score"]) : 0;
        a.Known = o["known"] as string;
        a.Near = Js.Truthy(o["near"]);
        a.Via = L(o["via"]).OfType<string>().ToList();
        return a;
    }
    private static Dictionary<string, Similar.Near> GraphOf(object? entries)
    {
        var g = new Dictionary<string, Similar.Near>();
        foreach (var e0 in L(entries))
        {
            var e = L(e0);
            var v = O(e.Count > 1 ? e[1] : null);
            g[Js.Str(e[0])] = new Similar.Near { Score = Js.ToNumber(v["score"]), Via = L(v["via"]).OfType<string>().ToList() };
        }
        return g;
    }
    private static List<object?> GraphJson(Dictionary<string, Similar.Near> g) => g.Select(kv =>
    {
        var v = new JsObj();
        v["score"] = kv.Value.Score;
        v["via"] = kv.Value.Via.Select(x => (object?)x).ToList();
        return (object?)new List<object?> { kv.Key, v };
    }).ToList();

    private static JsObj SimilarFns(JsObj job)
    {
        var o = new JsObj();
        o["normalize"] = L(job["names"]).Select(n => (object?)Similar.Normalize(n)).ToList();
        o["overlap"] = L(job["overlaps"]).Select(p0 => { var p = L(p0); return (object?)Similar.NamesOverlap(p.Count > 0 ? p[0] : null, p.Count > 1 ? p[1] : null); }).ToList();
        o["artists"] = L(job["artists"]).Select(c0 =>
        {
            var c = O(c0);
            return (object?)Similar.ReadDeezerArtists(c["json"], c["artist"]).Select(a =>
            {
                var x = new JsObj();
                x["id"] = a.Id;
                x["name"] = a.Name;
                x["fans"] = a.Fans;
                x["exact"] = a.Exact;
                return (object?)x;
            }).ToList();
        }).ToList();
        o["related"] = L(job["related"]).Select(c0 =>
        {
            var c = O(c0);
            var wanted = Js.ToNumber(c["wanted"]);
            return (object?)Similar.ReadDeezerRelated(c["json"], double.IsNaN(wanted) ? 0 : (int)wanted).Select(a =>
            {
                var x = new JsObj();
                x["id"] = a.Id;
                x["name"] = a.Name;
                x["picture"] = a.Picture;
                return (object?)x;
            }).ToList();
        }).ToList();
        o["pools"] = L(job["pools"]).Select(j => (object?)Similar.ReadDeezerPool(j).Select(a => (object?)a.PoolJson()).ToList()).ToList();
        o["years"] = L(job["years"]).Select(y => (object?)Similar.YearOf(y)).ToList();
        o["tops"] = L(job["tops"]).Select(j => (object?)Similar.ReadDeezerTop(j)).ToList();
        o["album_lists"] = L(job["album_lists"]).Select(j => (object?)Similar.ReadDeezerAlbumList(j)).ToList();
        o["tastes"] = L(job["tastes"]).Select(t0 =>
        {
            var t = O(t0);
            var seeds = L(t["seeds"]).Select(s0 => { var s = O(s0); return new Seed(Js.Str(s["name"]), Js.ToNumber(s["days"]), Js.ToNumber(s["last"])); });
            var rel = O(t["related"]);
            return (object?)GraphJson(Similar.TasteGraph(seeds, n => rel.Has(n) ? rel[n] as List<object?> : null, Js.ToNumber(t["now"])));
        }).ToList();
        o["ranks"] = L(job["ranks"]).Select(r0 =>
        {
            var r = O(r0);
            var known = O(r["known"]);
            var ranked = Similar.RankActs(L(r["pool"]).Select(p => Act.FromPool(O(p))).ToList(), S(r["playing"]), GraphOf(r["taste"]),
                n => known.Has(n) ? known[n] as string : null,
                L(r["heavy"]).OfType<string>().ToHashSet(), L(r["shown"]).OfType<string>().ToHashSet());
            return (object?)ranked.Select(a => (object?)ActJson(a)).ToList();
        }).ToList();
        o["chooses"] = L(job["chooses"]).Select(c0 =>
        {
            var c = O(c0);
            var rnd = L(c["rnd"]).Select(Js.ToNumber).ToList();
            var i = 0;
            var picks = Similar.Choose(L(c["ranked"]).Select(ActOf).ToList(), () => rnd[i++ % rnd.Count]);
            return (object?)picks.Select(a => (object?)a.Id).ToList();
        }).ToList();
        o["reasons"] = L(job["reasons"]).Select(c0 => { var c = O(c0); return (object?)Similar.ReasonFor(ActOf(c["act"]), S(c["playing"])); }).ToList();
        o["records"] = L(job["records"]).Select(c0 =>
        {
            var c = O(c0);
            return (object?)Similar.RecordFor(ActOf(c["act"]), c["top"] as JsObj, L(c["albums"]), L(c["owned"]).Select(x => Js.Str(x)));
        }).ToList();
        o["played"] = L(job["played"]).Select(c0 =>
        {
            var c = O(c0);
            var rows = L(c["rows"]).Select(r0 => { var r = O(r0); return (r["artist"], r["ts"]); });
            return (object?)Similar.PlayedArtists(rows, ShareLinks.PrimaryArtist, (int)Js.ToNumber(c["limit"])).Select(s =>
            {
                var x = new JsObj();
                x["name"] = s.Name;
                x["days"] = s.Days;
                x["last"] = s.Last;
                return (object?)x;
            }).ToList();
        }).ToList();
        return o;
    }

    private static JsObj Days(JsObj job)
    {
        var o = new JsObj();
        o["base"] = L(job["titles"]).Select(t => (object?)ReleaseDays.BaseTitle(t)).ToList();
        var batches = L(job["batches"]).Select(O).ToList();
        o["query"] = batches.Select(b => (object?)ReleaseDays.QueryFor(L(b["albums"]).Select(a => (Js.Str(O(a)["title"]), Js.Str(O(a)["artist"]))))).ToList();
        o["days"] = batches.Select(b =>
        {
            var albums = L(b["albums"]).Select(O).Select(a => (Js.Str(a["key"]), Js.Str(a["title"]), Js.Str(a["artist"]), Js.Str(a["year"]), a["date"] as string)).ToList();
            var days = ReleaseDays.MatchDays(albums, b["groups"] as List<object?>);
            return (object?)albums.Select(a => (object?)new List<object?> { a.Item1, days[a.Item1] }).ToList();
        }).ToList();
        return o;
    }

    private static JsObj LabelFns(JsObj job)
    {
        var o = new JsObj();
        o["plain"] = L(job["plain"]).Select(n => (object?)LabelLookup.PlainName(n)).ToList();
        o["types"] = L(job["images"]).Select(i0 =>
        {
            var i = O(i0);
            var t = LabelLogos.TypeOf(Convert.FromBase64String(Js.Str(i["b64"])), S(i["type"]));
            return t is { } x ? (object?)new List<object?> { x.Type, x.Ext } : null;
        }).ToList();
        return o;
    }
}
