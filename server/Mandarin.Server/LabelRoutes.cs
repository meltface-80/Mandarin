// LabelRoutes.cs — record labels (v0.8.20), from the labels part of
// lib/server/api-library.js, in the same shapes: the Labels wall and a
// label's albums, the lookups and logos looked for in the background (when
// labels are switched on, when the wall opens — once an hour at most, or when
// the set of labels changed — after a merge, and when a key is given), their
// log, a logo chosen by hand, and the Discogs and FanArt.tv keys with whether
// each service takes it. Answered here once the Node server has handed the
// labels' work over (Jobs.cs); until then, by the Node server.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static bool LabelsHeld => Jobs.Holds("labels") && Labels.Lookup != null && Labels.Logos != null;

    // ---------------------------------------------------------------- the passes

    private static readonly object LabelPass = new();
    private static long logoPassAt, lookupPassAt;
    private static string logoPassKeys = "";

    /* library.labels(): every label, alphabetical, as the wall has them. */
    private static List<LabelGroup> Wall(Snapshot s) => s.LabelsOn ? Sorted(s.LabelGroups.Values.ToList(), (a, b) => LcBase(a.Title, b.Title)) : [];

    /* The logos looked for, for the labels without one: at most hourly unless the labels changed (or forced). */
    public static bool WantLogos(Snapshot s, bool force)
    {
        var logos = Labels.Logos;
        if (logos == null || !s.LabelsOn) return false;
        var list = Wall(s);
        var keys = string.Join(",", list.Select(g => g.Key));
        lock (LabelPass)
        {
            if (!force && keys == logoPassKeys && Now - logoPassAt < 3600000) return false;
            logoPassAt = Now;
            logoPassKeys = keys;
        }
        if (force) LabelLogos.ClearMisses();
        return logos.FetchMissing(list.Select(g => (g.Key, g.Title)).ToList(), force);
    }

    /* The lookups, for the albums with no label of their own: at most hourly (or forced: everything asked again). */
    public static async Task<bool> WantLookups(Snapshot s, bool force)
    {
        var lookup = Labels.Lookup;
        if (lookup == null || !s.LabelsOn) return false;
        lock (LabelPass)
        {
            if (!force && Now - lookupPassAt < 3600000) return false;
            lookupPassAt = Now;
        }
        if (force) await LabelLookup.Forget();
        return lookup.Run(s, force);
    }

    /* wantLookups(force) || wantLogos(force): the lookups first; their end starts the logos. */
    private static async Task<bool> WantLabelWork(Snapshot s, bool force) => await WantLookups(s, force) || WantLogos(s, force);

    /* After the lookups: the logos pass sees the labels they found. */
    public static async Task AfterLookups()
    {
        lock (LabelPass) logoPassKeys = "";
        if (LabelsHeld && await CurrentCopy() is { } s) WantLogos(s, false);
    }

    /* After a change made here (LibraryChanges.cs) that the passes follow: the labels switched on, a merge. */
    private static async Task LabelsChanged(bool lookupsToo)
    {
        if (!LabelsHeld || await CurrentCopy() is not { } s) return;
        if (lookupsToo) { if (s.LabelsOn) await WantLabelWork(s, false); }
        else WantLogos(s, false);
    }

    private static JsObj ScanState(Snapshot s, LibState st)
    {
        var lookup = Labels.Lookup;
        var logos = Labels.Logos;
        (int Done, int Total)? busy = lookup is { Running: true } ? (lookup.Done, lookup.Total) : logos is { Running: true } ? (logos.Done, logos.Total) : null;
        var o = new JsObj();
        o["scanning"] = busy != null;
        o["progress"] = busy is { Total: > 0 } b ? (double)b.Done / b.Total : 1.0;
        o["count"] = s.LabelsOn ? (double)s.LabelGroups.Count : 0.0;
        o["builtAt"] = st.BuiltAt;
        o["lookups"] = lookup != null;
        return o;
    }

    /* library.labelStats(): how many albums the tags (or folders) name a label for, and how many they don't. */
    private static (int Labels, int Tagged, int LookedUp, int Untagged, int Total) LabelStats(Snapshot s)
    {
        int tagged = 0, lookedUp = 0;
        foreach (var al in s.Albums)
        {
            if (al.LabelSource == "lookup") lookedUp++;
            else if (!string.IsNullOrEmpty(al.LabelKey)) tagged++;
        }
        return (s.LabelGroups.Count, tagged, lookedUp, s.Albums.Count - tagged - lookedUp, s.Albums.Count);
    }

    /* Object.assign(o, more) */
    private static void Merge(JsObj o, JsObj more) { foreach (var k in more.Keys) o[k] = more[k]; }

    private static object? MergedFromJs(LabelGroup g) => g.MergedFrom.Select(m =>
    {
        var x = new JsObj();
        x["key"] = m.Key;
        x["display"] = m.Display;
        return (object?)x;
    }).ToList();

    /* library.labelAlbums(name): a label by any of its names, merged ones folded in. */
    private static LabelGroup? LabelByName(Snapshot s, string name) =>
        s.LabelsOn && s.LabelGroups.TryGetValue(s.MergedKey(Names.LabelKey(name)), out var g) ? g : null;

    private static string LabelText(object? v) => TJs.Truthy(v) ? TJs.Str(v) : "";

    /* res.type("text/plain").send(text), as Express sends it. */
    private static async Task<bool> SendText(HttpContext ctx, string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        var tag = "W/\"" + bytes.Length.ToString("x") + "-" + Convert.ToBase64String(SHA1.HashData(bytes))[..27] + "\"";
        var h = ctx.Response.Headers;
        h["X-Mandarin-Answered"] = "C#";
        h.ETag = tag;
        if (ctx.Request.Headers.IfNoneMatch.ToString().Contains(tag, StringComparison.Ordinal)) { ctx.Response.StatusCode = 304; return true; }
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = "text/plain; charset=utf-8";
        ctx.Response.ContentLength = bytes.Length;
        if (!HttpMethods.IsHead(ctx.Request.Method)) await ctx.Response.Body.WriteAsync(bytes);
        return true;
    }

    // ---------------------------------------------------------------- the routes

    /* GET /api/filters/labels: the wall, with the passes started if they're due. */
    private static async Task<bool> LabelWall(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return false;
        await WantLabelWork(s, false);
        var urls = LabelLogos.Urls();
        var o = new JsObj();
        o["labels"] = Wall(s).Select(g =>
        {
            var x = new JsObj();
            x["key"] = g.Key;
            x["title"] = g.Title;
            x["subtitle"] = AlbumsWord(g.Albums.Count);
            x["albumCount"] = (double)g.Albums.Count;
            x["image_key"] = g.Albums[0].ImageKey;
            x["logo_url"] = urls.TryGetValue(g.Key, out var u) ? u : null;
            x["mergedFrom"] = MergedFromJs(g);
            return (object?)x;
        }).ToList();
        Merge(o, ScanState(s, st));
        return await SendJs(ctx, o);
    }

    /* GET /api/label-albums?label=&order=alpha|random */
    private static Task<bool> LabelAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return Task.FromResult(false);
        var name = Names.JsTrim(Q(ctx, "label") ?? "");
        var order = Q(ctx, "order") == "random" ? "random" : "alpha";
        if (name.Length == 0) return Send(ctx, new JsonObject { ["error"] = "label query parameter required" }, 400);
        var g = LabelByName(s, name);
        if (g == null) return Send(ctx, new JsonObject { ["albums"] = new JsonArray(), ["total"] = 0, ["label"] = name, ["order"] = order, ["logo_url"] = null });
        var albums = g.Albums.ToList();
        if (order == "random")
            for (var i = albums.Count - 1; i > 0; i--) { var j = Random.Shared.Next(i + 1); (albums[i], albums[j]) = (albums[j], albums[i]); }
        var logo = Labels.Logos!.Get(g.Key);
        return Send(ctx, new JsonObject
        {
            ["albums"] = AlbumList(s, albums), ["total"] = albums.Count, ["label"] = g.Title, ["order"] = order, ["groupKey"] = g.Key,
            ["logo_url"] = logo?.Url,
            ["mergedFrom"] = new JsonArray(g.MergedFrom.Select(m => (JsonNode)new JsonObject { ["key"] = m.Key, ["display"] = m.Display }).ToArray())
        });
    }

    private static Task<bool> LabelScanStatus(HttpContext ctx, Snapshot s, LibState st) =>
        LabelsHeld ? SendJs(ctx, ScanState(s, st)) : Task.FromResult(false);

    /* POST /api/labels/rescan(-force): the rules applied again, and the passes run (forced: the misses too). */
    private static async Task<bool> LabelRescan(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return false;
        var force = (ctx.Request.Path.Value ?? "").Contains("force", StringComparison.Ordinal);
        // library.setLabelRules(labelRules()): the Node server applies them again (the music folders may have changed).
        await Tell(new JsonObject { ["labels"] = true });
        var fresh = await CurrentCopy() ?? s;
        // Forced, the logos not found before are asked for again even when the lookups go first.
        if (force) LabelLogos.ClearMisses();
        var started = await WantLabelWork(fresh, force);
        var o = new JsObj();
        o["ok"] = true;
        o["started"] = started;
        Merge(o, ScanState(fresh, st));
        return await SendJs(ctx, o);
    }

    /* GET /api/labels-scan-log: where the labels come from, and what the passes found. */
    private static Task<bool> LabelScanLog(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return Task.FromResult(false);
        var n = LabelStats(s);
        var lines = Sorted(Labels.Lookup!.Lines().Concat(Labels.Logos!.Lines()), string.CompareOrdinal);
        return SendText(ctx, $"Labels come from the files' tags, read with the library: {n.Labels} labels; {n.Tagged} albums carry a label tag, {n.LookedUp} have one looked up, {n.Untagged} have none.\n"
            + string.Join("\n", lines) + "\n");
    }

    /* GET /api/labels/logo-candidates?label=: Discogs' pictures for the label's page. */
    private static async Task<bool> LogoCandidates(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return false;
        var name = Names.JsTrim(Q(ctx, "label") ?? "");
        if (name.Length == 0) return await JsError(ctx, 400, "label required");
        if (LabelLogos.DiscogsToken().Length == 0)
        {
            var e = new JsObj();
            e["error"] = "Discogs token needed (Settings → Setup → API Keys)";
            e["candidates"] = new List<object?>();
            return await SendJs(ctx, e, 400);
        }
        try
        {
            var o = new JsObj();
            o["candidates"] = await Labels.Logos!.Candidates(name);
            return await SendJs(ctx, o);
        }
        catch (Exception e) { return await JsError(ctx, 500, e.Message); }
    }

    /* POST /api/labels/logo { label, url }: a logo chosen by hand (a candidate, or a pasted address). */
    private static async Task<bool> SaveLabelLogo(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var body = FromNode(b) as JsObj ?? new JsObj();
        string name = TJs.Trim(LabelText(body["label"])), url = TJs.Trim(LabelText(body["url"]));
        if (name.Length == 0 || url.Length == 0) return await JsError(ctx, 400, "label and url required");
        var g = LabelByName(s, name);
        if (g == null) return await JsError(ctx, 404, "No such label");
        try
        {
            var stored = await Labels.Logos!.Save(g.Key, url, "manual");
            var o = new JsObj();
            o["ok"] = true;
            o["storedUrl"] = stored;
            return await SendJs(ctx, o);
        }
        catch (Exception e) { return await JsError(ctx, 500, e.Message); }
    }

    /* DELETE /api/labels/logo?label= (or { label }): the logo gone again. */
    private static async Task<bool> RemoveLabelLogo(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return false;
        var q = Q(ctx, "label");
        string raw;
        if (!string.IsNullOrEmpty(q)) raw = q;
        else
        {
            var b = await Auth.Body(ctx);
            if (b == null) return true;
            raw = LabelText((FromNode(b) as JsObj ?? new JsObj())["label"]);
        }
        var g = LabelByName(s, TJs.Trim(raw));
        if (g == null) return await JsError(ctx, 404, "No such label");
        Labels.Logos!.Remove(g.Key);
        var o = new JsObj();
        o["ok"] = true;
        return await SendJs(ctx, o);
    }

    /* GET /api/settings/labels: on or off, and how the albums got their labels. */
    private static Task<bool> LabelSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld) return Task.FromResult(false);
        var n = LabelStats(s);
        var o = new JsObj();
        o["enabled"] = s.LabelsOn;
        o["count"] = s.LabelsOn ? (double)n.Labels : 0.0;
        o["scanning"] = ScanState(s, st)["scanning"];
        o["tagged"] = (double)n.Tagged;
        o["looked_up"] = (double)n.LookedUp;
        o["untagged"] = (double)n.Untagged;
        o["total"] = (double)n.Total;
        o["lookups"] = LabelLookup.Counts();
        o["logos"] = (double)LabelLogos.Urls().Count;
        o["discogs"] = LabelLogos.DiscogsToken().Length > 0;
        o["fanart"] = LabelLogos.FanartKey().Length > 0;
        return SendJs(ctx, o);
    }

    /* GET /api/settings/label-folder-depth: kept, and read the same whoever does the work. */
    private static Task<bool> LabelFolderDepth(HttpContext ctx, Snapshot s, LibState st)
    {
        var d = TJs.ParseInt(Labels.Setting("labelFolderDepth"));
        var o = new JsObj();
        o["depth"] = Math.Max(0, Math.Min(6, double.IsNaN(d) ? 0 : d));
        return SendJs(ctx, o);
    }

    private static readonly Dictionary<string, (string Setting, string Field, string Kind)> KeyRoutes = new()
    {
        ["/api/settings/fanart-key"] = ("fanartKey", "key", "fanart"),
        ["/api/settings/discogs-token"] = ("discogsToken", "token", "discogs"),
    };
    private static string Masked(string v) => v.Length > 0 ? "••••" + (v.Length > 4 ? v[^4..] : v) : "";

    /* GET /api/settings/fanart-key | discogs-token: enough of the key to know it, and whether the service takes it. */
    private static async Task<bool> KeyState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld || !KeyRoutes.TryGetValue(ctx.Request.Path.Value ?? "", out var r)) return false;
        var v = LabelText(Labels.Setting(r.Setting));
        var o = new JsObj();
        o["set"] = v.Length > 0;
        o["configured"] = v.Length > 0;
        o["masked"] = Masked(v);
        o["check"] = v.Length > 0 ? await Labels.Logos!.CheckKey(r.Kind, false) : null;
        return await SendJs(ctx, o);
    }

    /* POST /api/settings/fanart-key { key } | discogs-token { token }: kept, checked, and the passes run now. */
    private static async Task<bool> SaveKey(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!LabelsHeld || !KeyRoutes.TryGetValue(ctx.Request.Path.Value ?? "", out var r)) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var given = TJs.Trim(LabelText((FromNode(b) as JsObj ?? new JsObj())[r.Field]));
        Labels.SetSetting(r.Setting, given);
        // A key just given: the labels without a logo (and, with Discogs, the
        // albums without a label) are looked for now, not at the next hour.
        if (given.Length > 0 && s.LabelsOn)
        {
            lock (LabelPass) { logoPassKeys = ""; lookupPassAt = 0; }
            await WantLabelWork(s, false);
        }
        var v = LabelText(Labels.Setting(r.Setting));
        var o = new JsObj();
        o["ok"] = true;
        o["set"] = v.Length > 0;
        o["masked"] = Masked(v);
        o["check"] = v.Length > 0 ? await Labels.Logos!.CheckKey(r.Kind, true) : null;
        return await SendJs(ctx, o);
    }
}
