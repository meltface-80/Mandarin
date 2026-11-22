// IBroadcastArt.cs — an iBroadcast album's cover (bug list items 444, 504). iBroadcast gives every track a picture: the
// one in its file, or, for a file with none, a stand-in of its own (a loudspeaker with the album's title written on it).
// Mandarin can't tell the two apart from iBroadcast's answer, so the stand-in was taken for the album's cover, and with
// a cover of its own the album was never given a real one (a folder of the owner's showed the stand-in, its cover.jpg
// beside the files that were sent). So, for an album Mandarin uploaded, its folder here says:
//   - a picture in the folder (as the scan picks one: Scanner.PickArt): that, copied beside the database, so the cover
//     stays when the drive is away;
//   - none, but a picture in its first file: iBroadcast's is that one, and is used;
//   - neither: iBroadcast's is its stand-in. None is kept, and the cover finder (Extras/AutoCovers.cs) looks for one, as
//     it does for any album of the library with no cover of its own.
// An album uploaded some other way has iBroadcast's picture, as before: nothing here says which it is. One whose folder is
// on a drive that isn't here is looked at again at the next reading, iBroadcast's picture meanwhile.
//
// The folder is found from what was sent: each iBroadcast track keeps the path it was sent as ("path"), and Mandarin's
// record of its uploads (IBroadcastUploadSent.cs) the file each path was sent from. Decided once an album, kept in the
// cache's "ibroadcast-art" (folder, ibroadcast or none); a cover chosen in Edit album is the owner's and stays.
//
// Every album is reached (item 513). The run went through the library's albums in one go after each reading, and any
// one album's fault it didn't foresee (the database busy for more than its five seconds while the next reading or the
// upload wrote, a drive's folder failing to list) ended it there, unsaid: the albums after it, the newest among them,
// kept iBroadcast's stand-in reading after reading, and the booklets, kept after the covers, were never looked at.
// Now each album is its own: one that fails is said and left for the next reading, the rest go on; one run at a time
// (a reading during one has it go round again), the newest albums first; and each run says what it decided.
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastArt
{
    /// <summary>The cache's namespace for what was decided of each album's cover.</summary>
    // "…2" (item 509): every album decided again once, those uploaded before item 480 among them, which went untraced.
    public const string Ns = "ibroadcast-art2";

    private static readonly string[] Pictures = [".jpg", ".jpeg", ".png", ".webp"];

    /// <summary>What an album's cover is to be: from its folder (the picture's path), iBroadcast's, none, or not known yet (its folder away).</summary>
    public enum Kind { Folder, IBroadcast, None, Later, Unknown }

    /*
     * The file here a track iBroadcast keeps was sent from ([sentAs]: its path at iBroadcast), or null. Since item 480 the
     * path sent is the file's from its drive, the upload's records saying which file it was ([files]); before, the path
     * sent was the file's own, whole, and the records said nothing of it (item 509: those albums went untraced, without
     * their folders' covers and booklets): such a path is the file, where it is here.
     */
    internal static string? SourceOf(string? sentAs, IReadOnlyDictionary<string, string> files)
    {
        if (string.IsNullOrEmpty(sentAs)) return null;
        // As sent, or as iBroadcast may give it back: its letters composed otherwise ("é" one letter or two), a "/" before it.
        foreach (var asked in new[] { sentAs, Same(sentAs), Same(sentAs).TrimStart('/') })
            if (files.TryGetValue(asked, out var file)) return file;
        return sentAs.StartsWith('/') && File.Exists(sentAs) ? sentAs : null;
    }

    private static string Same(string path) => path.Normalize(System.Text.NormalizationForm.FormC);

    /// <summary>The file each sent path came from: what Mandarin uploaded, by the path iBroadcast keeps (and that path's letters composed).</summary>
    public static Dictionary<string, string> SentFrom()
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (file, was) in IBroadcastUploadSent.All())
            if (was.SentAs is { } s) { d.TryAdd(s, file); d.TryAdd(Same(s), file); }
        return d;
    }

    private static (long At, Dictionary<string, string> Files) sentFrom = (0, []);

    /// <summary>
    /// The folder album [key] was uploaded from, where Mandarin sent it and the folder is here (item 505: its booklets);
    /// null otherwise. What was sent is read again a minute at most after it was last read.
    /// </summary>
    public static string? FolderOf(string key)
    {
        string? from;
        using (var c = Db.Open())
            from = Library.Rows(c, "SELECT value FROM cache WHERE ns = 'ibroadcast-kept' AND key = $1", key).FirstOrDefault()?[0] is string v
                ? IBroadcastApi.Str(JsonNode.Parse(v)?["from"]) : null;
        if (string.IsNullOrEmpty(from)) return null;
        var now = Environment.TickCount64;
        var known = sentFrom;
        if (now - known.At > 60_000) sentFrom = known = (now, SentFrom());
        return SourceOf(from, known.Files) is { } file && Path.GetDirectoryName(file) is { } dir && Directory.Exists(dir) ? dir : null;
    }

    /// <summary>What [sentAs]'s album's cover is to be ([files]: SentFrom's), and the folder picture's path where it is one.</summary>
    public static async Task<(Kind Kind, string? Picture)> Decide(string? sentAs, IReadOnlyDictionary<string, string> files)
    {
        if (SourceOf(sentAs, files) is not { } file) return (Kind.Unknown, null);
        var dir = Path.GetDirectoryName(file);
        if (dir == null || !Directory.Exists(dir)) return (Kind.Later, null);
        var images = Directory.EnumerateFiles(dir).Where(f => Pictures.Contains(Path.GetExtension(f).ToLowerInvariant()) && !Path.GetFileName(f).StartsWith('.')).ToList();
        if (Scanner.PickArt(images) is { } pick) return (Kind.Folder, pick);
        if (!File.Exists(file)) return (Kind.Later, null);
        var (read, at) = await Covers.PictureIn(file);
        if (!read) return (Kind.Later, null);
        return (at != null ? Kind.IBroadcast : Kind.None, null);
    }

    private static readonly SemaphoreSlim One = new(1, 1);
    private static volatile bool again;

    /// <summary>
    /// Each iBroadcast album's cover not yet decided, or not yet fetched: from [server] (iBroadcast's artwork server)
    /// where it is iBroadcast's, kept in [dataDir]/ibroadcast/art. One run at a time: asked during one, it goes round again.
    /// </summary>
    public static async Task Run(string? server, string dataDir, string keptNs)
    {
        if (!await One.WaitAsync(0)) { again = true; return; }
        try
        {
            do { again = false; await RunOnce(server, dataDir, keptNs); } while (again);
        }
        finally { One.Release(); }
    }

    /* What a run decided, said once it ends. */
    private sealed class Tally
    {
        public int Looked, Folder, Own, StandIn, Untraced, Away, Failed;
        public string? UntracedFrom, FailedFirst;

        public void Fail(string key, Exception e) { Failed++; FailedFirst ??= $"{key}: {e.GetType().Name}: {e.Message}"; }

        public string Said() =>
            $"[ibroadcast] covers: {Looked} album(s) looked at — {Folder} from their folders, {Own} iBroadcast's (the file's own picture), "
            + $"{StandIn} stand-in(s) left for the cover finder, {Away} waiting for their drive, {Untraced} not traced to a file here"
            + (UntracedFrom != null ? $" (as iBroadcast has one: \"{UntracedFrom}\")" : "")
            + (Failed > 0 ? $"; {Failed} failed, tried again at the next reading (first: {FailedFirst})" : "");
    }

    private static async Task RunOnce(string? server, string dataDir, string keptNs)
    {
        var dir = Path.Combine(dataDir, "ibroadcast", "art");
        Directory.CreateDirectory(dir);
        List<object?[]> albums;
        // The newest first: an album just uploaded gets its cover at the first reading that has it.
        using (var c = Db.Open())
            albums = Library.Rows(c, @"SELECT a.id, a.key, k.value, a.art_path, d.value FROM albums a JOIN cache k ON k.ns = $1 AND k.key = a.key
                                       LEFT JOIN cache d ON d.ns = $2 AND d.key = a.key ORDER BY a.id DESC", keptNs, Ns);
        var files = SentFrom();
        var tally = new Tally();
        // What was decided before item 509, of the first reckoning's (its "ibroadcast" for every album uploaded before item 480): let go.
        try { using var c = Db.Open(); Library.Rows(c, "DELETE FROM cache WHERE ns = 'ibroadcast-art'"); }
        catch (Microsoft.Data.Sqlite.SqliteException e) { tally.Fail("the first reckoning's", e); }
        int changed = 0;
        foreach (var r in albums)
        {
            var key = (string)r[1]!;
            // Each album its own (item 513): one that fails is said and tried again at the next reading; the rest go on.
            try { if (await One1(r, key, server, dir, files, tally)) changed++; }
            catch (Exception e) when (e is not OperationCanceledException) { tally.Fail(key, e); }
        }
        if (tally.Looked > 0 || tally.Failed > 0) Server.Log(tally.Said());
        if (tally.StandIn > 0) Extras.AutoCovers.Current?.Kick();
        if (changed > 0) await Library.Tell(new JsonObject { ["services"] = "changed" });
    }

    /* Album [key]'s cover ([r]: its row; [files]: SentFrom's), decided or fetched where it isn't yet; whether its cover changed. */
    private static async Task<bool> One1(object?[] r, string key, string? server, string dir, IReadOnlyDictionary<string, string> files, Tally tally)
    {
        long id = (long)r[0]!;
        var kept = JsonNode.Parse((string)r[2]!);
        var decided = r[4] as string;
        var artPath = r[3] as string;
        // Its folder's cover decided and kept, but not the album's (a restore, item 511: the album read afresh from iBroadcast).
        if (decided == "folder" && string.IsNullOrEmpty(artPath) && Directory.EnumerateFiles(dir, key["ibroadcast:".Length..] + "-folder.*").FirstOrDefault() is { } keptCover)
        {
            var keptBytes = await File.ReadAllBytesAsync(keptCover);
            Set(id, keptCover, "ibf" + Convert.ToHexString(SHA256.HashData(keptBytes))[..10].ToLowerInvariant());
            return true;
        }
        if (decided is "folder" or "none" || decided == "ibroadcast" && !string.IsNullOrEmpty(artPath)) return false;
        tally.Looked++;
        var from = IBroadcastApi.Str(kept?["from"]);
        var (kind, picture) = decided == "ibroadcast" ? (Kind.IBroadcast, null) : await Decide(from, files);
        switch (kind)
        {
            case Kind.Folder:
                var bytes = await File.ReadAllBytesAsync(picture!);
                var to = Path.Combine(dir, key["ibroadcast:".Length..] + "-folder" + Path.GetExtension(picture!).ToLowerInvariant());
                await File.WriteAllBytesAsync(to, bytes);
                Set(id, to, "ibf" + Convert.ToHexString(SHA256.HashData(bytes))[..10].ToLowerInvariant());
                Decided(key, "folder");
                tally.Folder++;
                return true;
            case Kind.None:
                // iBroadcast's stand-in: no cover, so the cover finder looks for one (its last look at this album forgotten).
                if (!string.IsNullOrEmpty(artPath)) Set(id, null, null);
                Extras.AutoCoverStore.Forget(key);
                Decided(key, "none");
                tally.StandIn++;
                return !string.IsNullOrEmpty(artPath);
            case Kind.IBroadcast:
                Decided(key, "ibroadcast");
                tally.Own++;
                return string.IsNullOrEmpty(artPath) && server != null && await Fetch(server, IBroadcastApi.Str(kept?["cover"]), dir, key, id);
            case Kind.Unknown:
                // Not traced to a file here: looked at again at each reading, a drive with it perhaps here by then.
                Decided(key, "unknown");
                tally.Untraced++;
                if (!string.IsNullOrEmpty(from)) tally.UntracedFrom ??= from;
                return string.IsNullOrEmpty(artPath) && server != null && await Fetch(server, IBroadcastApi.Str(kept?["cover"]), dir, key, id);
            default:
                // Its folder away: iBroadcast's picture meanwhile, decided at a reading when the drive is here.
                tally.Away++;
                return string.IsNullOrEmpty(artPath) && server != null && await Fetch(server, IBroadcastApi.Str(kept?["cover"]), dir, key, id);
        }
    }

    // iBroadcast's picture for the album's first track, kept beside the database.
    private static async Task<bool> Fetch(string server, string? cover, string dir, string key, long id)
    {
        if (cover is null or "0") return false;
        var (status, body) = await ServiceHttp.GetBytes($"{server.TrimEnd('/')}/artwork/{cover}-1000", 15000);
        if (status is < 200 or > 299 || body.Length == 0) return false;
        var file = Path.Combine(dir, key["ibroadcast:".Length..] + ".jpg");
        await File.WriteAllBytesAsync(file, body);
        Set(id, file, "ib" + cover);
        return true;
    }

    private static void Set(long id, string? path, string? hash)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE albums SET art_path = $p, art_hash = $h WHERE id = $id";
        cmd.Parameters.AddWithValue("$p", (object?)path ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$h", (object?)hash ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    private static void Decided(string key, string what)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$ns", Ns);
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", what);
        cmd.Parameters.AddWithValue("$ts", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        cmd.ExecuteNonQuery();
    }
}
