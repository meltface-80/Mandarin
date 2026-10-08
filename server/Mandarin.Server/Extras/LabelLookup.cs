// LabelLookup.cs — a record label for the albums whose files carry none
// (v0.8.20): lib/labellookup.js, rule for rule.
//
// Asked about one album at a time, in the background: MusicBrainz first (a
// release search by title and artist; the labels come back with the hits),
// then Discogs (a release search; needs your token). What's found is kept in
// label_lookups by the album's identity, so a library rebuild keeps it; a
// miss is remembered for a month, and Force rescan asks about everything
// again. The files' own tags always win. The Node server, which keeps the
// library, is told when a pass ends (/internal/library/changed { lookups }).
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class LabelLookup(MusicBrainz? mb, string? discogsBaseUrl, int pauseMs, string version, Action<string> log)
{
    private const double MissTtl = 30.0 * 86400000;
    public const string DiscogsBase = "https://api.discogs.com";

    private readonly string discogsBase = (string.IsNullOrEmpty(discogsBaseUrl) ? DiscogsBase : discogsBaseUrl).TrimEnd('/');
    private readonly string ua = "Mandarin/" + version + " (+https://github.com/meltface-80/Mandarin)";
    private readonly object gate = new();

    public bool Running { get; private set; }
    public int Done, Total, Found;
    public long LastRunAt;
    private readonly List<string> lines = [];
    /* After a pass: the logos pass sees the labels it found. */
    public Func<Task>? OnDone { get; set; }
    /* Whether this server may go on (the Node server has handed the work over). */
    public Func<bool> Ready { get; init; } = () => true;

    [GeneratedRegex(ScanNames.Ws + "*\\([0-9]+\\)" + ScanNames.Ws + "*\\z")] private static partial Regex Numbered();
    [GeneratedRegex("^\\[[nN][oO] [lL][aA][bB][eE][lL]\\]\\z")] private static partial Regex NoLabel();
    [GeneratedRegex("^[nN][oO][tT] [oO][nN] [lL][aA][bB][eE][lL]\\z")] private static partial Regex NotOnLabel();
    [GeneratedRegex("[\"\\\\]")] private static partial Regex Quotable();

    /* "Blue Note (2)" → "Blue Note": Discogs numbers labels that share a name. */
    public static string PlainName(object? s) => Js.Trim(Numbered().Replace(Js.Truthy(s) ? Js.Str(s) : "", "", 1));

    public List<string> Lines() { lock (lines) return [.. lines]; }
    private void Note(string line)
    {
        lock (lines)
        {
            lines.Add(DateTime.UtcNow.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + " " + line);
            if (lines.Count > 400) lines.RemoveAt(0);
        }
        log("[labels] " + line);
    }

    public static string DiscogsToken() => Text(Labels.Setting("discogsToken"));
    private static string Text(object? v) => Js.Truthy(v) ? Js.Str(v) : "";

    /* The albums to ask about: no label of their own, and not asked (or missed) lately. */
    private static List<Album> Pending(Snapshot s, bool force)
    {
        var rows = new Dictionary<string, (string? Label, double At)>();
        if (!force)
        {
            using var c = Db.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT key, label, looked_up_at FROM label_lookups";
            using var r = cmd.ExecuteReader();
            while (r.Read()) rows[r.GetString(0)] = (r.IsDBNull(1) ? null : Convert.ToString(r.GetValue(1), CultureInfo.InvariantCulture), r.IsDBNull(2) ? 0 : r.GetDouble(2));
        }
        var now = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return s.Albums.Where(al =>
        {
            if (al.LabelSource is "tag" or "folder") return false;
            if (force) return true;
            if (!rows.TryGetValue(al.Key, out var row)) return true;
            if (!string.IsNullOrEmpty(row.Label)) return false;                 // found: kept
            return now - row.At > MissTtl;                                       // a miss: asked again after a month
        }).ToList();
    }

    private static List<object?> L(object? v) => v as List<object?> ?? [];

    /* MusicBrainz: the labels on the best release of this title by this artist. */
    private async Task<string?> FromMusicBrainz(Album al)
    {
        if (mb == null) return null;
        string Quote(string s) => Quotable().Replace(s, m => "\\" + m.Value);
        var parts = new List<string> { $"release:\"{Quote(al.Title)}\"" };
        if (al.Artist.Length > 0 && !al.Compilation) parts.Add($"artist:\"{Quote(al.Artist)}\"");
        var j = await mb.Get("release/", ("query", string.Join(" AND ", parts)), ("limit", 10.0));
        var want = Names.Fold(al.Title);
        var wantArtist = Names.Fold(al.Artist);
        var hits = L((j as JsObj)?["releases"]).Select(r => r as JsObj ?? new JsObj())
            .Where(r => Names.Fold(Text(r["title"])) == want && Score(r["score"]) >= 80).ToList();
        var byArtist = hits.Where(r => wantArtist.Length == 0 || Names.Fold(string.Join(" ", L(r["artist-credit"]).Select(c0 =>
        {
            var c = c0 as JsObj ?? new JsObj();
            return Text(Js.Truthy(c["name"]) ? c["name"] : c["artist"] is JsObj a ? a["name"] : null);
        }))) == wantArtist).ToList();
        foreach (var r in byArtist.Count > 0 ? byArtist : hits)
            foreach (var li in L(r["label-info"]))
            {
                var name = li is JsObj o && o["label"] is JsObj lb && Js.Truthy(lb["name"]) ? Js.Str(lb["name"]) : null;
                if (name != null && !Names.IsLikelyNotALabel(name) && !NoLabel().IsMatch(name)) return name;
            }
        return null;
    }
    private static double Score(object? v) { var n = Js.ToNumber(v); return double.IsNaN(n) ? 0 : n; }

    /* Discogs: the first release matching title and artist, its first label. */
    private async Task<string?> FromDiscogs(Album al)
    {
        var token = DiscogsToken();
        if (token.Length == 0) return null;
        var qs = "type=release&release_title=" + Lookups.Encode(al.Title) + (al.Artist.Length > 0 && !al.Compilation ? "&artist=" + Lookups.Encode(al.Artist) : "") + "&per_page=5";
        var j = await Lookups.Json($"{discogsBase}/database/search?{qs}", [("User-Agent", ua), ("Accept", "application/json"), ("Authorization", "Discogs token=" + token)], 15000);
        foreach (var r in L((j as JsObj)?["results"]))
        {
            var labels = (r as JsObj)?["label"] as List<object?>;
            var name = PlainName(labels is { Count: > 0 } ? labels[0] : null);
            if (name.Length > 0 && !Names.IsLikelyNotALabel(name) && !NotOnLabel().IsMatch(name)) return name;
        }
        return null;
    }

    /* Ask about every pending album, one at a time. → true when a pass started. */
    public bool Run(Snapshot s, bool force)
    {
        List<Album> todo;
        lock (gate)
        {
            if (Running || !s.LabelsOn) return false;
            todo = Pending(s, force);
            if (todo.Count == 0) return false;
            Running = true;
            Done = 0; Total = todo.Count; Found = 0;
            LastRunAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
        Note($"lookups: {todo.Count} album(s) without a label tag; asking MusicBrainz" + (DiscogsToken().Length > 0 ? " then Discogs" : " (no Discogs token for the rest)"));
        _ = Task.Run(async () =>
        {
            try
            {
                var errors = 0;
                foreach (var al in todo)
                {
                    if (!Ready()) break;
                    try
                    {
                        string? label = await FromMusicBrainz(al), source = "musicbrainz";
                        if (label == null) { label = await FromDiscogs(al); source = "discogs"; }
                        using (var c = Db.Open())
                        using (var cmd = c.CreateCommand())
                        {
                            cmd.CommandText = @"INSERT INTO label_lookups(key, label, source, looked_up_at) VALUES($k, $l, $s, $t)
                                                ON CONFLICT(key) DO UPDATE SET label=excluded.label, source=excluded.source, looked_up_at=excluded.looked_up_at";
                            cmd.Parameters.AddWithValue("$k", al.Key);
                            cmd.Parameters.AddWithValue("$l", (object?)label ?? DBNull.Value);
                            cmd.Parameters.AddWithValue("$s", label != null ? source : DBNull.Value);
                            cmd.Parameters.AddWithValue("$t", (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                            cmd.ExecuteNonQuery();
                        }
                        if (label != null) { Interlocked.Increment(ref Found); Note($"{al.Artist} — {al.Title}: {label} ({(source == "discogs" ? "Discogs" : "MusicBrainz")})"); }
                        else Note($"{al.Artist} — {al.Title}: no label found");
                        errors = 0;
                    }
                    catch (Exception e)
                    {
                        Note($"{al.Artist} — {al.Title}: {e.Message}");
                        if (e.Message.Contains("HTTP 429", StringComparison.Ordinal)) await Task.Delay(30000);
                        if (++errors >= 5) { Note("lookups: five errors in a row — stopping; the next rescan carries on"); break; }
                    }
                    Interlocked.Increment(ref Done);
                    if (pauseMs > 0) await Task.Delay(pauseMs);
                }
                Note($"lookups: done, {Found} of {Total} found");
            }
            catch (Exception e) { Note("lookups: " + e.Message); }
            lock (gate) Running = false;
            try
            {
                await Library.Tell(new JsonObject { ["lookups"] = true });
                if (OnDone != null) await OnDone();
            }
            catch (Exception e) { log($"[labels] {e.GetType().Name}: {e.Message}"); }
        });
        return true;
    }

    /* Force rescan: forget every answer (the Node server reads the library again) and ask again. */
    public static async Task Forget()
    {
        using (var c = Db.Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "DELETE FROM label_lookups";
            cmd.ExecuteNonQuery();
        }
        await Library.Tell(new JsonObject { ["lookups"] = true });
    }

    public static JsObj Counts()
    {
        double found = 0, missed = 0;
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT label FROM label_lookups";
        using var r = cmd.ExecuteReader();
        while (r.Read()) { if (!r.IsDBNull(0) && Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture) is { Length: > 0 }) found++; else missed++; }
        var o = new JsObj();
        o["found"] = found;
        o["missed"] = missed;
        return o;
    }
}
