// IBroadcastBooklets.cs — an uploaded iBroadcast album's booklets, kept here (bug list item 510). iBroadcast takes only
// the music; the booklets (the PDFs in the folder an album was uploaded from, and in a folder in it with no music,
// "Scans", "Artwork") were read from that folder (item 505), so with the drive taken away, as the owner means to once
// everything is uploaded, they were gone. So each album's are copied into the data folder (ibroadcast/booklets/<its
// iBroadcast id>) while its drive is here, once, after each reading of the library, and shown from there
// (Booklets.cs). An album whose drive isn't here is copied at a reading when it is, and counted as waiting meanwhile,
// so Settings → iBroadcast can say when every booklet is kept and the drives may go. Decided once an album, kept in
// the cache's "ibroadcast-booklets": how many were copied and their size (0 for an album with none).
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastBooklets
{
    /// <summary>The cache's namespace for what was kept of each album's booklets.</summary>
    public const string Ns = "ibroadcast-booklets";

    private static string root = "";
    private static int waiting;

    /// <summary>The folder album [key]'s booklets are kept in, where any are; null otherwise.</summary>
    public static string? KeptFor(string key)
    {
        if (root.Length == 0 || !key.StartsWith("ibroadcast:", StringComparison.Ordinal)) return null;
        var d = Path.Combine(root, key["ibroadcast:".Length..]);
        return Directory.Exists(d) ? d : null;
    }

    /// <summary>What is kept: { albums (with booklets), bytes, waiting (uploaded albums whose drive wasn't here at the last look) }.</summary>
    public static JsonObject Status()
    {
        long albums = 0, bytes = 0;
        using (var c = Db.Open())
            foreach (var r in Library.Rows(c, "SELECT value FROM cache WHERE ns = $1", Ns))
                if (r[0] is string v && JsonNode.Parse(v) is JsonObject o && (long?)o["n"] is > 0)
                {
                    albums++;
                    bytes += (long?)o["bytes"] ?? 0;
                }
        return new JsonObject { ["albums"] = albums, ["bytes"] = bytes, ["waiting"] = waiting };
    }

    /// <summary>Album [key]'s booklets let go: it is gone from iBroadcast.</summary>
    public static void Forget(string key)
    {
        if (KeptFor(key) is not { } d) return;
        try { Directory.Delete(d, recursive: true); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* held: gone at the next reading's look */ }
    }

    /// <summary>Where the booklets are kept ([dataDir]/ibroadcast/booklets): set as the server starts, so they show before the first reading.</summary>
    public static void Init(string dataDir) => root = Path.Combine(dataDir, "ibroadcast", "booklets");

    /// <summary>Each uploaded album's booklets not yet kept, copied from its folder where it is here ([keptNs]: the albums' cache).</summary>
    public static Task Run(string dataDir, string keptNs) => Task.Run(() =>
    {
        Init(dataDir);
        List<object?[]> albums;
        using (var c = Db.Open())
            albums = Library.Rows(c, "SELECT k.key, k.value FROM cache k LEFT JOIN cache d ON d.ns = $2 AND d.key = k.key WHERE k.ns = $1 AND d.key IS NULL", keptNs, Ns);
        var files = IBroadcastArt.SentFrom();
        int away = 0, copied = 0;
        long size = 0;
        foreach (var r in albums)
        {
            var key = (string)r[0]!;
            var from = IBroadcastApi.Str(JsonNode.Parse((string)r[1]!)?["from"]);
            if (string.IsNullOrEmpty(from)) continue;
            // The file it was sent from: as the upload's records say (item 480 on), else the whole path sent (before it).
            var file = files.TryGetValue(from, out var f) ? f : from.StartsWith('/') ? from : null;
            if (file == null || Path.GetDirectoryName(file) is not { } folder) continue;   // not uploaded from here
            if (!Directory.Exists(folder)) { away++; continue; }
            try
            {
                var (n, bytes) = Copy(folder, Path.Combine(root, key["ibroadcast:".Length..]));
                Keep(key, n, bytes);
                if (n > 0) { copied++; size += bytes; }
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Server.Log($"[ibroadcast] booklets of {key}: {e.Message}"); }
        }
        waiting = away;
        if (copied > 0 || away > 0)
            Server.Log($"[ibroadcast] booklets: {copied} album(s)' kept ({size / 1048576.0:0.#} MB){(away > 0 ? $", {away} waiting for their drive to be connected" : "")}");
    });

    // The folder's booklets (Booklets.PdfsIn's: its own and those of a folder in it with no music) into [to], each under its
    // own name, a folder's name before one from a folder in it ("Scans - Inlay.pdf"); how many, and their size.
    private static (int N, long Bytes) Copy(string folder, string to)
    {
        var pdfs = Booklets.PdfsIn([folder], []);
        if (pdfs.Count == 0) return (0, 0);
        Directory.CreateDirectory(to);
        long bytes = 0;
        int n = 0;
        foreach (var pdf in pdfs)
        {
            var sub = Path.GetFileName(Path.GetDirectoryName(pdf));
            var name = Path.GetDirectoryName(pdf) == Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder)) ? Path.GetFileName(pdf) : $"{sub} - {Path.GetFileName(pdf)}";
            var target = Path.Combine(to, name);
            for (int i = 2; File.Exists(target); i++) target = Path.Combine(to, $"{Path.GetFileNameWithoutExtension(name)} ({i}).pdf");
            File.Copy(pdf, target + ".part", overwrite: true);
            File.Move(target + ".part", target);
            bytes += new FileInfo(target).Length;
            n++;
        }
        return (n, bytes);
    }

    private static void Keep(string key, int n, long bytes)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$ns", Ns);
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", new JsonObject { ["n"] = n, ["bytes"] = bytes }.ToJsonString());
        cmd.Parameters.AddWithValue("$ts", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        cmd.ExecuteNonQuery();
    }
}
