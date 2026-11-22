// Backup.IBroadcast.cs — the iBroadcast albums' covers and booklets in a backup (bug list item 511). An uploaded album's
// cover from its folder (ibroadcast/art/<id>-folder.*, item 504) and its booklets (ibroadcast/booklets/<id>/, item 510)
// are kept in the data folder because the drives they came from go once everything is uploaded: a restore that lost
// them couldn't make them again. So the part "ibroadcast" carries them: each file an entry of its own, "ib/000001" and
// on (a tar name is 100 bytes at most, a booklet's path may be longer), and ibroadcast.json the index, each entry's
// place under the data folder's ibroadcast/, and what was decided of each album (its cover, its booklets), so a restore
// puts everything back as it was: the folder's cover shown again (IBroadcastArt.cs) and the booklets (Booklets.cs).
// iBroadcast's own pictures aren't carried: they are fetched again. Restored: the files moved into place, never outside
// ibroadcast/art and ibroadcast/booklets, and the decisions written back.
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Admin;

internal static partial class Backup
{
    private const string ArtNs = Services.IBroadcast.IBroadcastArt.Ns, BookletNs = Services.IBroadcast.IBroadcastBooklets.Ns;

    [GeneratedRegex(@"^ib/\d{6}\z")] internal static partial Regex IBroadcastEntry();
    [GeneratedRegex(@"^(art/[0-9]+-folder\.[a-z]+|booklets/[0-9]+/[^/\\]+\.pdf)\z")] private static partial Regex IBroadcastPlace();

    /* The part's entries added to [entries]: the kept covers and booklets under [dataDir], and their index; null when none are kept. */
    public static JsObj? IBroadcastPart(string dataDir, List<Entry> entries)
    {
        var root = Path.Combine(dataDir, "ibroadcast");
        var files = new List<string>();
        var art = Path.Combine(root, "art");
        if (Directory.Exists(art)) files.AddRange(Directory.EnumerateFiles(art, "*-folder.*"));
        var booklets = Path.Combine(root, "booklets");
        if (Directory.Exists(booklets)) files.AddRange(Directory.EnumerateFiles(booklets, "*.pdf", SearchOption.AllDirectories));
        if (files.Count == 0) return null;
        var map = new JsObj();
        int n = 0;
        foreach (var f in files.Order(StringComparer.Ordinal))
        {
            var place = Path.GetRelativePath(root, f).Replace('\\', '/');
            if (!IBroadcastPlace().IsMatch(place)) continue;
            var name = $"ib/{++n:D6}";
            map[name] = place;
            entries.Add(new Entry(name, File: f));
        }
        var index = new JsObj();
        index["files"] = map;
        using var c = Db.Open();
        index["art"] = CacheOf(c, ArtNs);
        index["booklets"] = CacheOf(c, BookletNs);
        return index;
    }

    private static JsObj CacheOf(Microsoft.Data.Sqlite.SqliteConnection c, string ns)
    {
        var o = new JsObj();
        foreach (var r in Library.Rows(c, "SELECT key, value FROM cache WHERE ns = $1", ns)) o[(string)r[0]!] = r[1];
        return o;
    }

    /*
     * The part restored: each file of [index] from [filesDir] (where ReadBackup put the entries) into [dataDir]'s
     * ibroadcast/, at its place, and what was decided of each album written back. How many files were put back.
     */
    public static int RestoreIBroadcast(JsObj index, string filesDir, string dataDir)
    {
        var root = Path.Combine(dataDir, "ibroadcast");
        int n = 0;
        if (index["files"] is JsObj files)
            foreach (var name in files.Keys)
            {
                if (files[name] is not string place || !IBroadcastPlace().IsMatch(place) || !IBroadcastEntry().IsMatch(name)) continue;
                var from = Path.Combine(filesDir, name[3..]);
                if (!File.Exists(from)) continue;
                var to = Path.Combine(root, place);
                Directory.CreateDirectory(Path.GetDirectoryName(to)!);
                File.Move(from, to, overwrite: true);
                n++;
            }
        using var c = Db.Open();
        foreach (var (ns, part) in new[] { (ArtNs, index["art"]), (BookletNs, index["booklets"]) })
        {
            if (part is not JsObj rows) continue;
            foreach (var key in rows.Keys)
            {
                if (rows[key] is not string value || !key.StartsWith("ibroadcast:", StringComparison.Ordinal)) continue;
                using var cmd = c.CreateCommand();
                cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
                cmd.Parameters.AddWithValue("$ns", ns);
                cmd.Parameters.AddWithValue("$k", key);
                cmd.Parameters.AddWithValue("$v", value);
                cmd.Parameters.AddWithValue("$ts", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                cmd.ExecuteNonQuery();
            }
        }
        return n;
    }
}
