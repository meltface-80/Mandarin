// CoverMend.cs — a Qobuz or Tidal album's cover fetched again where the file Mandarin kept of it is gone (item 530).
//
// A streamed album's cover is fetched once into the data folder (<data>/<service>/art/<id>.jpg, Rows.cs FetchArt) and
// the album's row names that file. A backup carries the rows but not those files, so a backup put back on a new install
// named some thousand covers that weren't there; an album is read again from its service only once its reading is a
// week old (Import.cs), and until then Covers.Find, its folder there and its tracks streamed, said it had no cover:
// the drawn stand-in, kept under the album's image key and sent as never changing, so the real cover fetched a week
// later still showed the stand-in. Now:
//   - a streamed album whose cover's file is gone isn't "no cover" (Covers.Find): the image route answers "not now"
//     (404 for five minutes) and the album is read again from its service here, its cover with it, one at a time;
//   - every streamed album whose file is gone is asked for so after every library scan and as the server starts (a
//     restore restarts it), not only those a screen shows;
//   - a cover's hash, its image key's end, is its picture's (Hash) and no longer its address's: a cover fetched again
//     is a new key, so a phone or a browser that kept the stand-in under the old one asks afresh. The covers kept with
//     the address's hash are given their picture's once (Rehash), their drawn sizes let go.
using System.Collections.Concurrent;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services;

internal static class CoverMend
{
    private static readonly ConcurrentQueue<string> Queue = new();
    private static readonly ConcurrentDictionary<string, byte> Waiting = new(StringComparer.Ordinal);
    // When each album was last read again here: not asked again within the hour (a service that has no cover for it,
    // or isn't signed in, isn't asked for it on every look at a wall).
    private static readonly ConcurrentDictionary<string, long> Tried = new(StringComparer.Ordinal);
    private const long AgainMs = 60 * 60 * 1000;
    private static int running, sweeping;
    // The setting saying the covers kept have their picture's hash (Rehash), done once.
    private const string RehashedKey = "coverHashesOfPictures";

    /// <summary>A cover's hash, its image key's end: twelve hex digits of its picture's MD5.</summary>
    public static string Hash(byte[] picture) => Convert.ToHexString(Fingerprint.Md5(picture)).ToLowerInvariant()[..12];

    /// <summary>The hash of the picture in [file]; null where it can't be read.</summary>
    public static string? Hash(string file)
    {
        try { return Hash(File.ReadAllBytes(file)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    /// <summary>
    /// Whether [al] is a streamed album, its cover's file gone: if so, it is read again from its service (queued) and
    /// its cover is "not now", never "none". False for an album of files (its cover is looked for in them).
    /// </summary>
    public static bool Asked(Album al)
    {
        if (al.Service is not ("qobuz" or "tidal")) return false;
        Ask(al.Key);
        return true;
    }

    /// <summary>The album keyed [key] ("qobuz:…", "tidal:…") read again from its service, its cover fetched, in turn.</summary>
    public static void Ask(string key)
    {
        if (Tried.TryGetValue(key, out var at) && Now() - at < AgainMs) return;
        if (Waiting.TryAdd(key, 0)) Queue.Enqueue(key);
        if (Interlocked.CompareExchange(ref running, 1, 0) == 0) _ = Task.Run(Work);
    }

    /// <summary>Every streamed album whose cover's file is gone, asked for; the covers kept with their address's hash given their picture's, once.</summary>
    public static void Sweep()
    {
        if (Interlocked.CompareExchange(ref sweeping, 1, 0) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await ArtFolder();
                var rows = Rows();
                var rehashed = await Rehash(rows);
                var gone = rows.Where(r => !File.Exists(r.Path)).Select(r => r.Key).ToList();
                if (gone.Count > 0) Server.Log($"[covers] {gone.Count} Qobuz or Tidal cover(s) not in the data folder (as after putting back a backup): fetched again");
                foreach (var k in gone) Ask(k);
                if (rehashed > 0) await Library.Tell(new JsonObject { ["services"] = "changed" });
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException) { Server.Log($"[covers] looking for streamed albums' covers: {e.Message}"); }
            finally { Interlocked.Exchange(ref sweeping, 0); }
        });
    }

    private sealed record Row(long Id, string Key, string Path, string? Hash);

    /* The streamed albums naming a cover's file. */
    private static List<Row> Rows()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, key, art_path, art_hash FROM albums WHERE (key LIKE 'qobuz:%' OR key LIKE 'tidal:%') AND art_path IS NOT NULL AND art_path <> ''";
        using var r = cmd.ExecuteReader();
        var list = new List<Row>();
        while (r.Read()) list.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3)));
        return list;
    }

    /* Once: each cover kept with its address's hash given its picture's, the sizes drawn under the old key let go. How many. */
    private static async Task<int> Rehash(List<Row> rows)
    {
        using var c = Db.Open();
        if (Db.Setting(c, RehashedKey) is JsonValue) return 0;
        int n = 0;
        foreach (var row in rows)
        {
            if (Hash(row.Path) is not { } h || h == row.Hash) continue;
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "UPDATE albums SET art_hash = $h WHERE id = $id";
                cmd.Parameters.AddWithValue("$h", h);
                cmd.Parameters.AddWithValue("$id", row.Id);
                cmd.ExecuteNonQuery();
            }
            if (Images.ArtDir.Length > 0) Covers.Forget(Images.ArtDir, row.Id, $"al-{row.Id}-{h}");
            n++;
            if (n % 200 == 0) await Task.Yield();
        }
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$k", RehashedKey);
            cmd.Parameters.AddWithValue("$v", Now().ToString(System.Globalization.CultureInfo.InvariantCulture));
            cmd.ExecuteNonQuery();
        }
        if (n > 0) Server.Log($"[covers] {n} Qobuz or Tidal cover(s) named by their picture now, not by its address: drawn again once");
        return n;
    }

    /* The albums asked for, one at a time; the library told every twenty, and at the end. */
    private static async Task Work()
    {
        int done = 0, failed = 0, since = 0;
        try
        {
            await ArtFolder();
            while (Queue.TryDequeue(out var key))
            {
                Waiting.TryRemove(key, out _);
                Tried[key] = Now();
                var svc = key.StartsWith("qobuz:", StringComparison.Ordinal) ? (Catalogue?)Jobs.Qobuz : Jobs.Tidal;
                if (svc == null || !svc.Connected()) { failed++; continue; }
                try
                {
                    // Its sizes drawn while its file was gone are stand-ins: let go, whatever its new key.
                    if (Images.ArtDir.Length > 0 && AlbumId(key) is long id) Covers.Forget(Images.ArtDir, id, null);
                    await svc.EnsureAlbum(key[svc.Key.Length..]);
                    done++;
                    if (++since >= 20) { since = 0; await Library.Tell(new JsonObject { ["services"] = "changed" }); }
                }
                catch (Exception e) when (e is not OutOfMemoryException) { failed++; Server.Log($"[covers] {key}: {e.Message}"); }
                await Task.Delay(250);
            }
        }
        finally
        {
            Interlocked.Exchange(ref running, 0);
            if (since > 0) await Library.Tell(new JsonObject { ["services"] = "changed" });
            if (done + failed > 0) Server.Log($"[covers] read again for their covers: {done} album(s){(failed > 0 ? $", {failed} not (signed out, or the service didn't answer)" : "")}");
            // Asked for while the last was ending: its turn now.
            if (!Queue.IsEmpty && Interlocked.CompareExchange(ref running, 1, 0) == 0) _ = Task.Run(Work);
        }
    }

    /*
     * The drawn covers' folder set (Images.Use) before any is let go (item 535): asked as the server starts (Jobs.cs's
     * AfterScan), this ran before it was, and the stand-ins drawn under an album's old key were left, the restore test
     * (test/qobuz-covers-restored.test.js) failing now and then. Waited for as Covers.Ahead waits, a minute at most.
     */
    private static async Task ArtFolder()
    {
        for (var i = 0; i < 240 && Images.ArtDir.Length == 0; i++) await Task.Delay(250);
    }

    private static long? AlbumId(string key)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id FROM albums WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        return cmd.ExecuteScalar() as long?;
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
