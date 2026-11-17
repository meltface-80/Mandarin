// IBroadcastUploadLocal.cs — the files an upload to iBroadcast sends (items 446, 455): All music, the library's (every
// file of it, album by album); a drive, every audio file on it, whether or not the library has it (item 455: a drive
// taken out of the music folders, still connected, still to be sent). What the library knows of a file (its album, its
// rate and depth, lossless or not) is taken where it has it; a file it doesn't know is named by its folders and known
// lossless or not by its kind. Hidden files and folders, lost+found, and what isn't audio (covers, cue sheets, logs)
// are left out. Only read: nothing on a drive is changed.
using System.Globalization;

namespace Mandarin.Server.Services.IBroadcast;

/// <summary>A file to send: where it is, its size and time (milliseconds, as the scanner keeps them), the album it is said under, and what is known of its sound (rate 0: not known).</summary>
internal sealed record LocalFile(string Path, long Size, long Mtime, string Album, bool Lossless, long Rate, int Bits);

internal static class IBroadcastUploadLocal
{
    /// <summary>What a drive's files are sent as where they are audio: iBroadcast's own formats and DSD among them.</summary>
    public static readonly HashSet<string> Audio = ["flac", "fla", "mp3", "m4a", "mp4", "aac", "ogg", "oga", "opus", "wav", "wave", "aif", "aiff", "aifc", "dsf", "dff",
        "ape", "wv", "wma", "alac", "mpc"];
    private static readonly HashSet<string> LosslessKinds = ["flac", "fla", "wav", "wave", "aif", "aiff", "aifc", "dsf", "dff", "ape", "wv", "alac"];

    /// <summary>The files [from] sends: All music's (the library's), or a drive's, album by album.</summary>
    public static List<LocalFile> Of(string? from)
    {
        var known = Library(from == IBroadcastUploadChoices.All ? null : from);
        if (from == IBroadcastUploadChoices.All || from == null) return known;
        var byPath = known.ToDictionary(f => f.Path, StringComparer.Ordinal);
        var list = new List<LocalFile>();
        foreach (var path in Walk(from).Order(StringComparer.Ordinal))
        {
            if (byPath.TryGetValue(path, out var f)) { list.Add(f); continue; }
            FileInfo fi;
            try { fi = new FileInfo(path); if (!fi.Exists) continue; } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            var ext = System.IO.Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
            var dir = System.IO.Path.GetDirectoryName(path) ?? "";
            var album = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(dir) ?? "") is { Length: > 0 } artist && dir != from
                ? artist + " – " + System.IO.Path.GetFileName(dir) : System.IO.Path.GetFileName(dir);
            list.Add(new(path, fi.Length, new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeMilliseconds(), album, LosslessKinds.Contains(ext), 0, 0));
        }
        return list;
    }

    /* Every audio file under [root], hidden ones, lost+found and what can't be read left out. */
    private static IEnumerable<string> Walk(string root)
    {
        var dirs = new Stack<string>([root]);
        while (dirs.Count > 0)
        {
            var d = dirs.Pop();
            string[] files, subs;
            try { files = Directory.GetFiles(d); subs = Directory.GetDirectories(d); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            foreach (var s in subs)
            {
                var name = System.IO.Path.GetFileName(s);
                if (!name.StartsWith('.') && name != "lost+found") dirs.Push(s);
            }
            foreach (var f in files)
            {
                var name = System.IO.Path.GetFileName(f);
                if (!name.StartsWith('.') && Audio.Contains(System.IO.Path.GetExtension(name).TrimStart('.').ToLowerInvariant())) yield return f;
            }
        }
    }

    /* The library's files, or those under [under], album by album (a file once, though a cue sheet makes it many tracks). */
    private static List<LocalFile> Library(string? under)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"SELECT t.path, MAX(t.size), MAX(t.mtime), MIN(a.artist || ' – ' || a.title), MAX(t.lossless), MAX(COALESCE(t.sample_rate, 0)), MAX(COALESCE(t.bits, 0))
            FROM tracks t JOIN albums a ON a.id = t.album_id WHERE t.path NOT LIKE '%://%'" + (under != null ? " AND substr(t.path, 1, $n) = $p" : "") + @" GROUP BY t.path
            ORDER BY MIN(a.sort_artist), MIN(a.sort_title), MIN(a.id), t.path";
        if (under != null) { cmd.Parameters.AddWithValue("$n", under.Length + 1); cmd.Parameters.AddWithValue("$p", under + "/"); }
        using var r = cmd.ExecuteReader();
        var list = new List<LocalFile>();
        long N(int i) => Convert.ToInt64(r.GetValue(i), CultureInfo.InvariantCulture);
        while (r.Read()) list.Add(new(r.GetString(0), N(1), N(2), r.GetString(3), N(4) != 0, N(5), (int)N(6)));
        return list;
    }
}
