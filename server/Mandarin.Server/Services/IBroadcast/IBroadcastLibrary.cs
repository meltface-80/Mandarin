// IBroadcastLibrary.cs — the iBroadcast library in Mandarin's (item 444): iBroadcast's library server answers the whole
// library at once (tracks, albums, artists, each an id → an array of values, with a map naming the places), and its
// status says when it last changed (status.lastmodified): read again only then, every ten minutes at most, or when
// Update library now asks. Each album becomes a service album, as a Qobuz one is: a row keyed "ibroadcast:<id>", its
// tracks "ibroadcast://track/<id>", kept (the cache's "ibroadcast-kept") and on the walls while "iBroadcast albums in
// the library" is on (the setting "ibroadcastSettings", on unless switched off). Written as the files say them:
//   - an album iBroadcast keeps a disc an entry ("disc": 1, 2…, one name, one artist) one album again, its discs;
//   - and the discs of one title its name says ("The Wall (Disc 1)", "The Wall (Disc 2)") one album too (item 512);
//   - albums merged into one from the library's selection menu kept so (album_merges, IBroadcastMerges.cs, item 512);
//   - its format from the file's type: FLAC, WAV and AIFF lossless, MP3, AAC and the rest not; its ReplayGain kept;
//   - in the trash, never;
//   - one you have here too (one title and one artist, as Mandarin Migration compares them): left out, the files here
//     its copy, and counted ("also here").
// Its cover: its folder's, iBroadcast's for its first track, or none for the cover finder (IBroadcastArt.cs, item 504).
//
// A track is one row whichever album it is under (item 489). Each album's tracks were written as new unless that album
// had them already, so a track iBroadcast had moved to another album, listed under two, or listed twice in one, was
// written a second time: "UNIQUE constraint failed: tracks.path", the whole reading undone, and nothing said but an
// unwaited task's failure in the log. From noon on the day iBroadcast's uploads failed, every reading of a real library
// ended so, and it stood at 3,732 albums while iBroadcast had 4,927. Now a track is found wherever it is and moved, its
// id kept; it is written under the album its own entry names (else the first to list it), once; and a reading whose
// rows can't be written says so, wherever it was asked for.
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;

namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcastLibrary(IBroadcast account, string dataDir)
{
    /// <summary>The page's switch: { import } (on unless switched off).</summary>
    public const string SettingsKey = "ibroadcastSettings";
    /// <summary>What the last reading found: { lastmodified, at, albums, also_here, tracks, artwork_server, streaming_server }.</summary>
    public const string StateKey = "ibroadcastLibrary";
    private const string KeptNs = "ibroadcast-kept";
    /// <summary>How often iBroadcast is asked whether the library changed: ten minutes (the tests' ibroadcast_watch_ms).</summary>
    public double WatchMs { get; init; } = 10 * 60 * 1000;

    private readonly SemaphoreSlim one = new(1, 1);
    private Timer? timer;

    /// <summary>Whether it is being read now.</summary>
    public bool Reading { get; private set; }

    /// <summary>Looked at now and every ten minutes: read again where iBroadcast says it changed.</summary>
    public void Start() => timer = new Timer(_ => _ = Watch(), null, TimeSpan.FromMilliseconds(Math.Min(20_000, WatchMs)), TimeSpan.FromMilliseconds(WatchMs));

    /// <summary>Stopped.</summary>
    public void Stop() => timer?.Dispose();

    private async Task Watch()
    {
        try { await Read(false); }
        catch (ServiceError e) { Server.Log("[ibroadcast] the library couldn't be read: " + e.Message); }
    }

    /// <summary>The page's switch: whether iBroadcast's albums are in the library.</summary>
    public static bool Shown()
    {
        using var c = Db.Open();
        return Db.Setting(c, SettingsKey) is not JsonObject o || o["import"] is not JsonValue v || !v.TryGetValue<bool>(out var on) || on;
    }

    /// <summary>The switch set; the library told.</summary>
    public static async Task SetShown(bool on)
    {
        Save(SettingsKey, new JsonObject { ["import"] = on });
        await Library.Tell(new JsonObject { ["services"] = "changed" });
    }

    /// <summary>The library read again: [force] whatever iBroadcast says of when it changed. What it found.</summary>
    public async Task<JsonObject?> Read(bool force)
    {
        if (!IBroadcast.Connected()) return null;
        await one.WaitAsync();
        Reading = true;
        try
        {
            var kept = State();
            if (!force)
            {
                var st = await account.Api.Json("status");
                // Unchanged, and every track's file known: as it is. A library read before the files were kept (item 450: an
                // update to 445 left them unknown, and nothing played) is read again whatever iBroadcast says.
                if (IBroadcastApi.Str(st["status"]?["lastmodified"]) is { } lm && lm == IBroadcastApi.Str(kept?["lastmodified"]) && FilesKnown()) return kept;
            }
            var answer = await account.Api.Json("library", null, account.Api.Library);
            JsonObject found;
            try { found = Write(answer); }
            // Whatever goes wrong writing it is said as iBroadcast's own refusals are, by everything that reads it (item 489:
            // it wasn't one of those, so it went unsaid: a task that failed with no one waiting on it).
            catch (Exception e) when (e is not ServiceError) { throw new ServiceError($"its rows couldn't be written ({e.GetType().Name}: {e.Message})", 500); }
            Save(StateKey, found);
            Server.Log($"[ibroadcast] the library read: {found["albums"]} albums in it, {found["also_here"]} of them here as files too, {found["tracks"]} tracks");
            await Library.Tell(new JsonObject { ["services"] = "changed" });
            // The covers, then the booklets (items 504, 510): whatever stops either is said (item 513: it went unsaid, nothing awaiting it).
            _ = Task.Run(async () =>
            {
                try { await IBroadcastArt.Run(IBroadcastApi.Str(found["artwork_server"]), dataDir, KeptNs); }
                catch (Exception e) { Server.Log($"[ibroadcast] covers: stopped: {e.GetType().Name}: {e.Message}", "WARN"); }
                try { await IBroadcastBooklets.Run(dataDir, KeptNs); }
                catch (Exception e) { Server.Log($"[ibroadcast] booklets: stopped: {e.GetType().Name}: {e.Message}", "WARN"); }
            });
            // Each lossless track's rate and depth, read from its file (item 445).
            if (Jobs.IBroadcastStreams is { } streams) _ = Task.Run(streams.Rates);
            return found;
        }
        finally { Reading = false; one.Release(); }
    }

    /// <summary>Whether every iBroadcast track's file is known (IBroadcastStreams.FilesNs), for its stream's address.</summary>
    public static bool FilesKnown()
    {
        using var c = Db.Open();
        return Library.Rows(c, @"SELECT COUNT(*) FROM tracks t WHERE t.path LIKE 'ibroadcast://track/%'
            AND NOT EXISTS (SELECT 1 FROM cache k WHERE k.ns = $1 AND k.key = substr(t.path, 20))", IBroadcastStreams.FilesNs)[0][0] is long n && n == 0;
    }

    /// <summary>What the last reading found; null before the first.</summary>
    public static JsonObject? State()
    {
        using var c = Db.Open();
        return Db.Setting(c, StateKey) as JsonObject;
    }

    /// <summary>Signed out: iBroadcast's albums out of the library.</summary>
    public static async Task Forget()
    {
        using (var c = Rows())
        {
            Run(c, "DELETE FROM albums WHERE key LIKE 'ibroadcast:%'");
            Run(c, "DELETE FROM cache WHERE ns = $ns", ("$ns", KeptNs));
            Run(c, "DELETE FROM cache WHERE ns = $ns", ("$ns", IBroadcastStreams.FilesNs));
            Run(c, "DELETE FROM settings WHERE key = $k", ("$k", StateKey));
        }
        await Library.Tell(new JsonObject { ["services"] = "changed" });
    }

    /* One of the library's tables as id → (name → value), by its map. */
    private static Dictionary<string, Dictionary<string, JsonNode?>> Table(JsonNode? t)
    {
        var o = new Dictionary<string, Dictionary<string, JsonNode?>>(StringComparer.Ordinal);
        if (t is not JsonObject table || table["map"] is not JsonObject map) return o;
        foreach (var (id, row) in table)
        {
            if (id == "map" || row is not JsonArray values) continue;
            o[id] = map.Where(m => m.Value is JsonValue).ToDictionary(m => m.Key, m => m.Value!.GetValue<int>() is var i && i >= 0 && i < values.Count ? values[i] : null);
        }
        return o;
    }

    private static string Text(JsonNode? n) => IBroadcastApi.Str(n) ?? "";
    private static double? Number(JsonNode? n) => n is JsonValue v && (v.TryGetValue<double>(out var d) || (v.TryGetValue<string>(out var s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d))) ? d : null;
    /* An album entry's disc: iBroadcast's, else the one its name says ("(Disc 2)"), else 1. */
    private static double DiscOf(Dictionary<string, JsonNode?> a) =>
        Number(a.GetValueOrDefault("disc")) is double d && d > 1 ? d : Scanner.DiscOfTitle(Text(a.GetValueOrDefault("name")))?.Disc ?? (Number(a.GetValueOrDefault("disc")) is double e && e > 0 ? e : 1);
    private static bool Trashed(Dictionary<string, JsonNode?> r) => r.GetValueOrDefault("trashed") is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    /* A file's format from its type: codec, container, lossless. */
    private static (string Codec, string Container, bool Lossless) Format(string type) => type.ToLowerInvariant() switch
    {
        var t when t.Contains("flac") => ("flac", "flac", true),
        var t when t.Contains("wav") => ("pcm", "wav", true),
        var t when t.Contains("aif") => ("pcm", "aiff", true),
        var t when t.Contains("mpeg") || t.Contains("mp3") => ("mp3", "mp3", false),
        var t when t.Contains("ogg") || t.Contains("opus") => ("opus", "ogg", false),
        var t when t.Contains("mp4") || t.Contains("m4a") || t.Contains("aac") => ("aac", "mp4", false),
        _ => ("unknown", "unknown", false),
    };

    /* iBroadcast's library as rows: what was written. */
    private JsonObject Write(JsonObject answer)
    {
        var lib = answer["library"] as JsonObject ?? throw new ServiceError("iBroadcast sent no library", 502);
        var albums = Table(lib["albums"]);
        var tracks = Table(lib["tracks"]);
        var artists = Table(lib["artists"]);
        string ArtistName(JsonNode? id) => artists.TryGetValue(Text(id), out var a) ? Text(a.GetValueOrDefault("name")) : "";
        using var c = Rows();
        var here = new HashSet<string>(Library.Rows(c, "SELECT title, artist FROM albums WHERE dir IS NULL OR dir NOT LIKE '%://%'")
            .Select(r => Library.ExportCanon((string?)r[0] ?? "") + "|" + Library.ExportCanon((string?)r[1] ?? "")), StringComparer.Ordinal);
        // An album a disc an entry: one album again (one name, one artist), under its first id; and the discs of one title
        // named in it ("The Wall (Disc 1)", "The Wall CD2") one album, as a folder's are (item 512, Scan/Scanner.Discs.cs).
        var sets = albums.Where(a => !Trashed(a.Value))
            .GroupBy(a => Library.ExportCanon(Scanner.DiscOfTitle(Text(a.Value.GetValueOrDefault("name")))?.Title ?? Text(a.Value.GetValueOrDefault("name"))) + "|" + Text(a.Value.GetValueOrDefault("artist_id")))
            .Select(g => g.OrderBy(a => DiscOf(a.Value)).ThenBy(a => a.Key, StringComparer.Ordinal).ToList()).ToList();
        // The albums merged into one from the library's selection menu (item 512, IBroadcastMerges.cs): a merged album
        // written under the one it was merged into, while that is here, its discs after the same disc.
        var merges = IBroadcastMerges.Read(c);
        var setAt = sets.Select((set, i) => ("ibroadcast:" + set[0].Key, i)).ToDictionary(x => x.Item1, x => x.i, StringComparer.Ordinal);
        (string Title, string Artist) NamesAt(int at)
        {
            var title = Text(sets[at][0].Value.GetValueOrDefault("name"));
            var artist = ArtistName(sets[at][0].Value.GetValueOrDefault("artist_id"));
            if (sets[at].Count > 1 && Scanner.DiscOfTitle(title) is { } named) title = named.Title;
            return (title, artist.Length > 0 ? artist : "Unknown artist");
        }
        bool AlsoHere(int at) => NamesAt(at) is var n && here.Contains(Library.ExportCanon(n.Title) + "|" + Library.ExportCanon(n.Artist));
        bool Folded(string k) => merges.TryGetValue(k, out var m) && m.Into != k && setAt.TryGetValue(m.Into, out var i) && !AlsoHere(i);
        var alive = sets.SelectMany(set => set.Select(a => "ibroadcast:" + a.Key)).ToHashSet(StringComparer.Ordinal);
        var written = new List<string>();
        int alsoHere = 0, trackCount = 0, moved = 0;
        var now = IBroadcastApi.Now();
        // Which album each track is written under (item 489): the one its own entry names, where that is among these; else
        // the first to list it. Once, however many list it.
        var setOf = sets.SelectMany((set, i) => set.Select(a => (a.Key, i))).ToDictionary(x => x.Key, x => x.i, StringComparer.Ordinal);
        var under = new Dictionary<string, int>(StringComparer.Ordinal);
        int listedTwice = 0;
        for (int i = 0; i < sets.Count; i++)
            foreach (var tid in sets[i].SelectMany(a => a.Value.GetValueOrDefault("tracks") as JsonArray ?? []).Select(Text))
            {
                if (!tracks.TryGetValue(tid, out var tr) || Trashed(tr)) continue;
                if (under.ContainsKey(tid)) { listedTwice++; continue; }
                under[tid] = setOf.TryGetValue(Text(tr.GetValueOrDefault("album_id")), out var named) ? named : i;
            }
        using var tx = c.BeginTransaction();
        // Every iBroadcast track here now, wherever it is: one under another album is moved, not written again.
        var all = Library.Rows(c, "SELECT path, id, album_id FROM tracks WHERE path LIKE 'ibroadcast://track/%'")
            .ToDictionary(r => (string)r[0]!, r => (Id: (long)r[1]!, Album: r[2] as long? ?? 0), StringComparer.Ordinal);
        var kept = new HashSet<string>(StringComparer.Ordinal);
        List<(double Disc, string Id, Dictionary<string, JsonNode?> T)> RowsAt(int at) =>
            [.. sets[at].SelectMany(a => (a.Value.GetValueOrDefault("tracks") as JsonArray ?? []).Select(id => (Disc: DiscOf(a.Value), Id: Text(id))))
                .Where(t => under.TryGetValue(t.Id, out var u) && u == at).DistinctBy(t => t.Id).Select(t => (t.Disc, t.Id, T: tracks[t.Id]))];
        for (int at = 0; at < sets.Count; at++)
        {
            var set = sets[at];
            var first = set[0].Value;
            var (title, artist) = NamesAt(at);
            if (AlsoHere(at)) { alsoHere++; continue; }
            var key = "ibroadcast:" + set[0].Key;
            if (Folded(key)) continue;
            var rows = RowsAt(at);
            foreach (var (mk, m) in merges.Where(m => m.Value.Into == key && m.Key != key && setAt.ContainsKey(m.Key)).OrderBy(m => m.Value.Disc))
                rows.AddRange(RowsAt(setAt[mk]).Select(t => (t.Disc + m.Disc, t.Id, t.T)));
            if (rows.Count == 0) continue;
            var formats = rows.Select(t => Format(Text(t.T.GetValueOrDefault("type")))).ToList();
            var year = Number(first.GetValueOrDefault("year")) is double y && y > 0 ? y : rows.Select(t => Number(t.T.GetValueOrDefault("year"))).FirstOrDefault(v => v > 0);
            var genres = new JsonArray([.. rows.Select(t => Text(t.T.GetValueOrDefault("genre"))).Where(g => g.Length > 0).Distinct().Select(g => (JsonNode?)g)]).ToJsonString();
            (string, object?)[] album =
            [
                ("$key", key), ("$title", title), ("$artist", artist), ("$sort_title", ScanNames.SortName(title)), ("$sort_artist", ScanNames.SortName(artist)),
                ("$year", year), ("$genres", genres), ("$dir", "ibroadcast://album/" + set[0].Key), ("$track_count", (double)rows.Count),
                ("$duration", rows.Sum(t => Number(t.T.GetValueOrDefault("length")) ?? 0)), ("$lossless", formats.All(f => f.Lossless) ? 1.0 : 0.0),
                ("$container", formats[0].Container), ("$compilation", artist.Equals("various artists", StringComparison.OrdinalIgnoreCase) ? 1.0 : 0.0), ("$now", now),
            ];
            long id;
            if (Library.Rows(c, "SELECT id FROM albums WHERE key = $1", key).FirstOrDefault()?[0] is long was)
            {
                id = was;
                Run(c, @"UPDATE albums SET title=$title, artist=$artist, sort_title=$sort_title, sort_artist=$sort_artist, year=$year, genres=$genres,
                         track_count=$track_count, duration=$duration, lossless=$lossless, container=$container, compilation=$compilation, updated_at=$now WHERE key=$key", album);
            }
            else
            {
                Run(c, @"INSERT INTO albums(key, title, artist, sort_title, sort_artist, year, genres, dir, track_count, duration, max_rate, max_bits, lossless, container,
                         compilation, added_at, updated_at) VALUES($key, $title, $artist, $sort_title, $sort_artist, $year, $genres, $dir, $track_count, $duration,
                         44100, 16, $lossless, $container, $compilation, $now, $now)", album);
                id = (long)Library.Rows(c, "SELECT last_insert_rowid()")[0][0]!;
            }
            // Each track kept as it was (item 450): its id, so a queue or a play still knows it, and its rate and depth, read once.
            foreach (var (disc, tid, t) in rows)
            {
                var (codec, container, lossless) = Format(Text(t.GetValueOrDefault("type")));
                var trackArtist = ArtistName(t.GetValueOrDefault("artist_id"));
                var had = all.TryGetValue("ibroadcast://track/" + tid, out var was1);
                if (had && was1.Album != id) moved++;
                kept.Add("ibroadcast://track/" + tid);
                var sql = had
                    ? @"UPDATE tracks SET album_id=$album_id, size=$size, title=$title, artist=$artist, album_artist=$album_artist, album=$album, track_no=$track_no,
                        disc_no=$disc_no, duration=$duration, codec=$codec, container=$container, lossless=$lossless, year=$year, genres=$genres, rg_track_gain=$gain
                        WHERE path=$path"
                    : @"INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration, codec, container,
                         channels, lossless, year, genres, has_picture, rg_track_gain) VALUES($album_id, $path, 0, $size, $title, $artist, $album_artist, $album,
                         $track_no, $disc_no, $duration, $codec, $container, 2, $lossless, $year, $genres, 0, $gain)";
                Run(c, sql,
                    ("$album_id", id), ("$path", "ibroadcast://track/" + tid), ("$size", Number(t.GetValueOrDefault("size")) ?? 0), ("$title", Text(t.GetValueOrDefault("title"))),
                    ("$artist", trackArtist.Length > 0 ? trackArtist : artist), ("$album_artist", artist), ("$album", title), ("$track_no", Number(t.GetValueOrDefault("track"))),
                    ("$disc_no", disc), ("$duration", Number(t.GetValueOrDefault("length")) ?? 0), ("$codec", codec), ("$container", container), ("$lossless", lossless ? 1 : 0),
                    ("$year", Number(t.GetValueOrDefault("year")) is double ty && ty > 0 ? ty : year), ("$genres", genres), ("$gain", Number(t.GetValueOrDefault("replay_gain"))));
                trackCount++;
            }
            // Each track's file at iBroadcast, for its stream's address (item 445, IBroadcastStreams.cs).
            foreach (var (_, tid, t) in rows)
                Run(c, "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts",
                    ("$ns", IBroadcastStreams.FilesNs), ("$k", tid), ("$v", Text(t.GetValueOrDefault("file"))), ("$ts", now));
            Run(c, "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts",
                ("$ns", KeptNs), ("$k", key), ("$v", new JsonObject { ["why"] = "library", ["at"] = now, ["cover"] = Text(rows[0].T.GetValueOrDefault("artwork_id")), ["from"] = Text(rows[0].T.GetValueOrDefault("path")) }.ToJsonString()), ("$ts", now));
            written.Add(key);
        }
        // Gone from iBroadcast (or here as files now): gone here, its tracks first, those of an album that stays among them.
        foreach (var gone in all.Where(h => !kept.Contains(h.Key))) Run(c, "DELETE FROM tracks WHERE id = $id", ("$id", gone.Value.Id));
        var keep = written.ToHashSet(StringComparer.Ordinal);
        foreach (var gone in Library.Rows(c, "SELECT key FROM albums WHERE key LIKE 'ibroadcast:%'").Select(r => (string)r[0]!).Where(k => !keep.Contains(k)).ToList())
        {
            Run(c, "DELETE FROM albums WHERE key = $k", ("$k", gone));
            if (alive.Contains(gone)) continue;   // a disc of another album now, or merged into one (item 512): what is kept of it stays
            Run(c, "DELETE FROM cache WHERE ns = $ns AND key = $k", ("$ns", KeptNs), ("$k", gone));
            Run(c, "DELETE FROM cache WHERE ns = $ns AND key = $k", ("$ns", IBroadcastArt.Ns), ("$k", gone));
            Run(c, "DELETE FROM cache WHERE ns = $ns AND key = $k", ("$ns", IBroadcastBooklets.Ns), ("$k", gone));
            IBroadcastBooklets.Forget(gone);
        }
        tx.Commit();
        if (moved > 0 || listedTwice > 0)
            Server.Log($"[ibroadcast] the library read: {moved} track(s) now under another album, moved; {listedTwice} listed more than once, each written once under the album its own entry names");
        return new JsonObject
        {
            ["lastmodified"] = IBroadcastApi.Str(answer["status"]?["lastmodified"]), ["at"] = now, ["albums"] = written.Count + alsoHere, ["also_here"] = alsoHere,
            ["tracks"] = trackCount, ["artwork_server"] = IBroadcastApi.Str(answer["settings"]?["artwork_server"]), ["streaming_server"] = IBroadcastApi.Str(answer["settings"]?["streaming_server"]),
        };
    }

    private static Microsoft.Data.Sqlite.SqliteConnection Rows()
    {
        var c = Db.Open();
        Run(c, "PRAGMA foreign_keys = ON");
        return c;
    }

    private static void Run(Microsoft.Data.Sqlite.SqliteConnection c, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    private static void Save(string key, JsonObject value)
    {
        using var c = Db.Open();
        Run(c, "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ("$k", key), ("$v", value.ToJsonString()));
    }
}
