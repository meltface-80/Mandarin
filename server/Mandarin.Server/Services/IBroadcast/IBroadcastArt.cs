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
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastArt
{
    /// <summary>The cache's namespace for what was decided of each album's cover.</summary>
    public const string Ns = "ibroadcast-art";

    private static readonly string[] Pictures = [".jpg", ".jpeg", ".png", ".webp"];

    /// <summary>What an album's cover is to be: from its folder (the picture's path), iBroadcast's, none, or not known yet (its folder away).</summary>
    public enum Kind { Folder, IBroadcast, None, Later }

    /// <summary>The folder each sent path came from: what Mandarin uploaded, by the path iBroadcast keeps.</summary>
    public static Dictionary<string, string> SentFrom() =>
        IBroadcastUploadSent.All().Where(f => f.Value.SentAs != null)
            .GroupBy(f => f.Value.SentAs!, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First().Key, StringComparer.Ordinal);

    /// <summary>What [sentAs]'s album's cover is to be ([files]: SentFrom's), and the folder picture's path where it is one.</summary>
    public static async Task<(Kind Kind, string? Picture)> Decide(string? sentAs, IReadOnlyDictionary<string, string> files)
    {
        if (string.IsNullOrEmpty(sentAs) || !files.TryGetValue(sentAs, out var file)) return (Kind.IBroadcast, null);
        var dir = Path.GetDirectoryName(file);
        if (dir == null || !Directory.Exists(dir)) return (Kind.Later, null);
        var images = Directory.EnumerateFiles(dir).Where(f => Pictures.Contains(Path.GetExtension(f).ToLowerInvariant()) && !Path.GetFileName(f).StartsWith('.')).ToList();
        if (Scanner.PickArt(images) is { } pick) return (Kind.Folder, pick);
        if (!File.Exists(file)) return (Kind.Later, null);
        var (read, at) = await Covers.PictureIn(file);
        if (!read) return (Kind.Later, null);
        return (at != null ? Kind.IBroadcast : Kind.None, null);
    }

    /// <summary>
    /// Each iBroadcast album's cover not yet decided, or not yet fetched: from [server] (iBroadcast's artwork server)
    /// where it is iBroadcast's, kept in [dataDir]/ibroadcast/art.
    /// </summary>
    public static async Task Run(string? server, string dataDir, string keptNs)
    {
        var dir = Path.Combine(dataDir, "ibroadcast", "art");
        Directory.CreateDirectory(dir);
        List<object?[]> albums;
        using (var c = Db.Open())
            albums = Library.Rows(c, @"SELECT a.id, a.key, k.value, a.art_path, d.value FROM albums a JOIN cache k ON k.ns = $1 AND k.key = a.key
                                       LEFT JOIN cache d ON d.ns = $2 AND d.key = a.key", keptNs, Ns);
        var files = SentFrom();
        int changed = 0, none = 0;
        foreach (var r in albums)
        {
            long id = (long)r[0]!;
            var key = (string)r[1]!;
            var kept = JsonNode.Parse((string)r[2]!);
            var decided = r[4] as string;
            var artPath = r[3] as string;
            if (decided != null && (decided != "ibroadcast" || !string.IsNullOrEmpty(artPath))) continue;
            var (kind, picture) = decided == "ibroadcast" ? (Kind.IBroadcast, null) : await Decide(IBroadcastApi.Str(kept?["from"]), files);
            try
            {
                switch (kind)
                {
                    case Kind.Folder:
                        var bytes = await File.ReadAllBytesAsync(picture!);
                        var to = Path.Combine(dir, key["ibroadcast:".Length..] + "-folder" + Path.GetExtension(picture!).ToLowerInvariant());
                        await File.WriteAllBytesAsync(to, bytes);
                        Set(id, to, "ibf" + Convert.ToHexString(SHA256.HashData(bytes))[..10].ToLowerInvariant());
                        Decided(key, "folder");
                        changed++;
                        break;
                    case Kind.None:
                        // iBroadcast's stand-in: no cover, so the cover finder looks for one (its last look at this album forgotten).
                        if (!string.IsNullOrEmpty(artPath)) { Set(id, null, null); changed++; }
                        Extras.AutoCoverStore.Forget(key);
                        Decided(key, "none");
                        none++;
                        break;
                    case Kind.IBroadcast:
                        Decided(key, "ibroadcast");
                        if (string.IsNullOrEmpty(artPath) && server != null && await Fetch(server, IBroadcastApi.Str(kept?["cover"]), dir, key, id)) changed++;
                        break;
                    default:
                        // Its folder away: iBroadcast's picture meanwhile, decided at a reading when the drive is here.
                        if (string.IsNullOrEmpty(artPath) && server != null && await Fetch(server, IBroadcastApi.Str(kept?["cover"]), dir, key, id)) changed++;
                        break;
                }
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or Tags.JsError) { Server.Log($"[ibroadcast] cover of {key}: {e.Message}"); }
        }
        if (none > 0)
        {
            Server.Log($"[ibroadcast] {none} album(s) had only iBroadcast's stand-in for a cover: left for the cover finder");
            Extras.AutoCovers.Current?.Kick();
        }
        if (changed > 0) await Library.Tell(new JsonObject { ["services"] = "changed" });
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
