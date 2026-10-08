// IdentifyRoutes.cs — Settings → Identify albums (v0.8.19), from
// lib/server/api-identify.js, in the same shapes: the scan's switches and
// times, how far it has got, what it proposes, what it applied (and undo),
// what it couldn't place, the album editor's Find match, and the MusicBrainz
// pack. Answered here once the Node server has handed the scan over
// (Jobs.cs); until then, by the Node server.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    /* res.json(value) for a value of JavaScript's shapes (Tags/Js.cs): JSON.stringify's text. */
    private static async Task<bool> SendJs(HttpContext ctx, object? body, int status = 200)
    {
        var bytes = Encoding.UTF8.GetBytes(TJs.Json(body) ?? "null");
        var tag = "W/\"" + bytes.Length.ToString("x") + "-" + Convert.ToBase64String(SHA1.HashData(bytes))[..27] + "\"";
        var h = ctx.Response.Headers;
        h["X-Mandarin-Answered"] = "C#";
        h.ETag = tag;
        if (status == 200 && ctx.Request.Headers.IfNoneMatch.ToString().Contains(tag, StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return true; }
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        ctx.Response.ContentLength = bytes.Length;
        if (!HttpMethods.IsHead(ctx.Request.Method)) await ctx.Response.Body.WriteAsync(bytes);
        return true;
    }
    private static Task<bool> JsError(HttpContext ctx, int status, string message)
    {
        var o = new JsObj();
        o["error"] = message;
        return SendJs(ctx, o, status);
    }

    /* A JSON value as JavaScript's JSON.parse made it. */
    public static object? FromNode(JsonNode? n)
    {
        switch (n)
        {
            case null: return null;
            case JsonObject o:
                var j = new JsObj();
                foreach (var (k, v) in o) j[k] = FromNode(v);
                return j;
            case JsonArray a: return a.Select(FromNode).ToList();
            case JsonValue v:
                return v.GetValueKind() switch
                {
                    JsonValueKind.String => v.GetValue<string>(),
                    JsonValueKind.Number => double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture),
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    _ => null
                };
            default: return null;
        }
    }

    // --------------------------------------------------------------- the page

    /* One verdict as the page shows it: the album, and the release it was matched to (or nearest). */
    private static JsObj ListItem(Snapshot s, MatchRow r, Album al)
    {
        object? cand = null;
        try { cand = TJs.Truthy(r.Candidate) ? Scan.JsJson.Parse(TJs.Str(r.Candidate)) : null; } catch (Exception) { /* none */ }
        var c = cand as JsObj ?? (TJs.Truthy(cand) ? new JsObj() : null);
        var o = new JsObj();
        o["album"] = FromNode(AlbumJson(s, al, new JsonObject { ["artist"] = al.Artist }));
        var scanned = new JsObj();
        scanned["title"] = al.ScannedTitle;
        scanned["artist"] = al.ScannedArtist;
        scanned["year"] = al.ScannedYear is long y ? (double)y : null;
        o["scanned"] = scanned;
        o["distance"] = r.Distance;
        o["similarity"] = TJs.IsNullish(r.Distance) ? null : TJs.Round((1 - TJs.ToNumber(r.Distance)) * 100);
        o["checked_at"] = r.CheckedAt;
        o["applied_at"] = r.AppliedAt;
        o["ambiguous"] = c != null && TJs.Truthy(c["ambiguous"]);
        o["why"] = c != null ? Score.Why(c["parts"], al.Year is long ay ? (double)ay : null).Select(x => (object?)x).ToList() : new List<object?>();
        if (c != null)
        {
            var x = new JsObj();
            object? Or(object? v) => TJs.Truthy(v) ? v : null;
            x["mbid"] = c["mbid"];
            x["title"] = Score.Clean(c["title"]);
            x["artist"] = c["artist"];
            x["year"] = c["year"];
            x["track_count"] = c["track_count"];
            x["release_title"] = Or(c["release_title"]);
            x["release_year"] = Or(c["release_year"]);
            x["edition"] = Or(c["edition"]);
            x["manual"] = Or(c["manual"]);
            x["matched_by"] = Or(c["matched_by"]);
            x["from_pack"] = TJs.Truthy(c["from_pack"]);
            x["type"] = Or(c["type"]);
            x["country"] = Or(c["country"]);
            x["source"] = TJs.Truthy(c["source"]) ? c["source"] : "musicbrainz";
            x["tracks"] = (c["tracks"] as List<object?> ?? []).Select(t => t is JsObj tj ? tj["title"] : Undef.V).ToList();
            x["parts"] = TJs.Truthy(c["parts"]) ? c["parts"] : null;
            o["candidate"] = x;
        }
        else o["candidate"] = null;
        return o;
    }

    /* The page's state; with the lists of albums only when asked (lists > 0), each list's full length in counts. */
    private static Task<JsObj> IdentifyPage(Identifier id, Snapshot s, LibState st, int lists) => id.Reading(() =>
    {
        var state = id.State(s, st);
        List<MatchRow> all;
        using (var c = Db.Open()) all = Identifier.RowList(c);
        var byKeyRows = new Dictionary<string, MatchRow>();
        foreach (var r in all) byKeyRows[r.Key] = r;
        var o = new JsObj();
        o["settings"] = state["settings"];
        o["reason"] = state["reason"];
        o["active"] = state["active"];
        o["current"] = state["current"];
        o["progress"] = Identifier.Progress(s, byKeyRows);
        if (lists > 0)
        {
            var limits = new (string Status, int N)[] { ("proposed", lists), ("unidentified", lists), ("applied", Math.Min(lists, 100)), ("rejected", Math.Min(lists, 100)) };
            var byKey = new Dictionary<string, Album>();
            foreach (var al in s.Albums) byKey[al.Key] = al;
            var counts = new JsObj();
            foreach (var (status, n) in limits)
            {
                var list = all.Where(r => r.Status == status && byKey.ContainsKey(r.Key)).ToList();
                double When(MatchRow r) => TJs.Truthy(r.AppliedAt) ? TJs.ToNumber(r.AppliedAt) : TJs.ToNumber(r.CheckedAt);
                list = Sorted(list, (a, b) => Lookups.Sgn(When(b) - When(a)));
                o[status] = list.Take(n).Select(r => (object?)ListItem(s, r, byKey[r.Key])).ToList();
                counts[status] = (double)list.Count;
            }
            o["counts"] = counts;
        }
        return o;
    });

    // --------------------------------------------------------------- the routes

    private static Identifier? HeldIdentify => Jobs.Held ? Jobs.Identify : null;

    /* GET /api/identify[?lists=<how many of each>] */
    private static async Task<bool> IdentifyState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        var q = Q(ctx, "lists");
        var n = q == null ? 500 : (int)Math.Max(0, Math.Min(500, PInt(q) is long v ? v : 0));
        return await SendJs(ctx, await IdentifyPage(id, s, st, n));
    }

    [GeneratedRegex("^[0-9]{1,2}:[0-9]{2}\\z")]
    private static partial Regex TimeShape();

    /* POST /api/identify/settings { enabled, schedule, itunes, start, end } */
    private static async Task<bool> IdentifySettings(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var body = FromNode(b) as JsObj ?? new JsObj();
        foreach (var k in new[] { "start", "end" })
            if (!TJs.IsUndef(body[k]) && !TimeShape().IsMatch(TJs.Str(body[k]))) return await JsError(ctx, 400, $"{k} must be a time like 01:00");
        id.SetSettings(body);
        return await SendJs(ctx, await IdentifyPage(id, s, st, 500));
    }

    /* { offset } names the album; the scan's verdict is by its key. */
    private static async Task<bool> IdentifyAct(HttpContext ctx, Snapshot s, LibState st, string what)
    {
        if (HeldIdentify is not { } id) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var al = s.Find(JsNumber(b["offset"]));
        if (al == null) return await JsError(ctx, 404, "No such album");
        // The verdict's album as the scan finds it by its key: one on the walls (albumFor).
        var listed = !al.Transient;
        var done = what switch
        {
            "accept" => listed && await id.Accept(al) != null,
            "reject" => await id.Reject(al, listed) != null,
            "undo" => listed && await id.UndoIt(al) != null,
            _ => await id.Recheck(al, listed)
        };
        if (!done) return await JsError(ctx, 409, "Nothing to " + what + " for this album");
        var cur = await Current();
        return cur is var (s2, st2) ? await SendJs(ctx, await IdentifyPage(id, s2, st2, 500)) : await SendJs(ctx, await IdentifyPage(id, s, st, 500));
    }
    private static Task<bool> IdentifyAccept(HttpContext ctx, Snapshot s, LibState st) => IdentifyAct(ctx, s, st, "accept");
    private static Task<bool> IdentifyReject(HttpContext ctx, Snapshot s, LibState st) => IdentifyAct(ctx, s, st, "reject");
    private static Task<bool> IdentifyUndo(HttpContext ctx, Snapshot s, LibState st) => IdentifyAct(ctx, s, st, "undo");
    private static Task<bool> IdentifyRecheck(HttpContext ctx, Snapshot s, LibState st) => IdentifyAct(ctx, s, st, "recheck");

    /* POST /api/identify/recheck-all */
    private static async Task<bool> IdentifyRecheckAll(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        await id.RecheckAll();
        return await SendJs(ctx, await IdentifyPage(id, s, st, 500));
    }

    /* GET /api/identify/candidates?offset= — the releases this album could be, scored, best first. Nothing is written. */
    private static async Task<bool> IdentifyCandidates(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return await JsError(ctx, 404, "No such album");
        if (al.Transient) return await SendJs(ctx, null);
        try { return await SendJs(ctx, await id.Suggest(al)); }
        catch (Exception e) { return await JsError(ctx, e is IdentifyError ie ? ie.Status : 502, "MusicBrainz didn't answer (" + e.Message + ")"); }
    }

    [GeneratedRegex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex Uuid();
    [GeneratedRegex("release-group/([0-9a-fA-F-]{36})")]
    private static partial Regex GroupLink();
    [GeneratedRegex("release/([0-9a-fA-F-]{36})")]
    private static partial Regex ReleaseLink();
    [GeneratedRegex("^[0-9\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff-]{8,}\\z")]
    private static partial Regex BarcodeShape();

    /* POST /api/identify/match { offset, query, how }: a barcode, or a MusicBrainz release / release-group link or id, applied. */
    private static async Task<bool> IdentifyMatch(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var body = FromNode(b) as JsObj ?? new JsObj();
        var al = s.Find(JsNumber(b["offset"]));
        if (al == null) return await JsError(ctx, 404, "No such album");
        var q = TJs.Trim(TJs.Truthy(body["query"]) ? TJs.Str(body["query"]) : "");
        var pick = TJs.StrictEq(body["how"], "pick");
        string? barcode = null, mbid = null, group = null;
        Match m;
        if (pick && q.Length > 0) mbid = q;                                      // one of our own suggestions, by its id
        else if ((m = GroupLink().Match(q)).Success) group = m.Groups[1].Value;
        else if ((m = ReleaseLink().Match(q)).Success) mbid = m.Groups[1].Value;
        else if (Uuid().IsMatch(q) && q.Length == 36) mbid = q;
        else if (BarcodeShape().IsMatch(q)) barcode = q;
        else return await JsError(ctx, 400, "Enter a barcode (the digits under the bars), or paste a MusicBrainz release link");
        try { if (!al.Transient) await id.Match(s, al, barcode, mbid, group, pick ? "pick" : null); }
        catch (Exception e) { return await JsError(ctx, e is IdentifyError ie ? ie.Status : 500, e.Message); }
        var cur = await Current();
        return cur is var (s2, st2) ? await SendJs(ctx, await IdentifyPage(id, s2, st2, 500)) : await SendJs(ctx, await IdentifyPage(id, s, st, 500));
    }

    // --------------------------------------------------------------- the pack

    /* GET /api/identify/pack[?check=1]: what's here, what's published, and the download's progress. */
    private static Task<bool> PackState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || Jobs.Packs is not { } p) return Task.FromResult(false);
        if (Q(ctx, "check") is { Length: > 0 }) p.CheckSoon();
        var o = p.Status();
        o["check_error"] = p.DescribeError;
        return SendJs(ctx, o);
    }

    /* POST /api/identify/pack/download */
    private static Task<bool> PackDownload(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || Jobs.Packs is not { } p) return Task.FromResult(false);
        return SendJs(ctx, p.Download());
    }

    /* POST /api/identify/pack/remove */
    private static Task<bool> PackRemove(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || Jobs.Packs is not { } p) return Task.FromResult(false);
        try { return SendJs(ctx, p.Remove()); }
        catch (Exception e) { return JsError(ctx, e is PackError pe ? pe.Status : 500, e.Message); }
    }

    /* POST /api/identify/pack/folder { dir }: keep the pack in that folder (null: the data folder). */
    private static async Task<bool> PackFolder(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || Jobs.Packs is not { } p) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var dir = FromNode(b["dir"]);
        try { return await SendJs(ctx, await p.SetDir(TJs.Truthy(dir) ? TJs.Str(dir) : null)); }
        catch (Exception e) { return await JsError(ctx, e is PackError pe ? pe.Status : 500, e.Message); }
    }
}
