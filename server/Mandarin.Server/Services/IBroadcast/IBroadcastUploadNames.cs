// IBroadcastUploadNames.cs — the name a file is sent to iBroadcast as (item 480). iBroadcast took a real upload's 46
// files and kept none of them, upload after upload: each of them had a long name (181 to 240 bytes: an opera's scene,
// its first words and who sings them), sent with the whole path here (/data/Storage/USB/<drive>/<folders>/<name>),
// over the 255 a name field so often holds. A file is now sent as its path from the drive it is on, its name cut to
// NameMost bytes (the track number and the start of the title kept, "…" where it is cut, and its extension), and its
// folders, outermost first, left out where the whole would be over PathMost. iBroadcast names a track by its tags, not
// by its file's name, so what it shows is the same; nothing on the drive is changed.
using System.Text;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastUploadNames
{
    /// <summary>The most a name sent may take (bytes, UTF-8).</summary>
    public const int NameMost = 100;
    /// <summary>The most a path sent may take, its folders and its name (bytes, UTF-8).</summary>
    public const int PathMost = 160;

    /// <summary>
    /// The path [path] is sent as: from the drive of [drives] it is on (the innermost), its extension [ext] where it is
    /// sent made into another kind (".flac"), its name cut to fit, and its outer folders left out where the whole won't.
    /// </summary>
    public static string SentAs(string path, IEnumerable<string> drives, string? ext = null)
    {
        var root = drives.Select(d => d.TrimEnd('/')).Where(d => d.Length > 0 && path.StartsWith(d + "/", StringComparison.Ordinal))
            .OrderByDescending(d => d.Length).FirstOrDefault();
        var rel = root != null ? path[(root.Length + 1)..] : Path.GetFileName(path);
        if (ext != null) rel = Path.ChangeExtension(rel, ext);
        var parts = rel.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var name = Cut(parts[^1], NameMost);
        var folders = parts[..^1].ToList();
        while (folders.Count > 0 && Bytes(string.Join('/', folders) + "/" + name) > PathMost) folders.RemoveAt(0);
        return folders.Count > 0 ? string.Join('/', folders) + "/" + name : name;
    }

    /* [name] in [most] bytes at most: as it is where it fits, else its start, "…" and its extension. */
    private static string Cut(string name, int most)
    {
        if (Bytes(name) <= most) return name;
        var ext = Path.GetExtension(name);
        var room = most - Bytes(ext) - Bytes("…");
        var kept = new StringBuilder();
        var used = 0;
        foreach (var r in name[..^ext.Length].EnumerateRunes())
        {
            if (used + r.Utf8SequenceLength > room) break;
            kept.Append(r.ToString());
            used += r.Utf8SequenceLength;
        }
        return kept.ToString().TrimEnd(' ', '-', '.', ',', ';', '(', '\'') + "…" + ext;
    }

    private static int Bytes(string s) => Encoding.UTF8.GetByteCount(s);
}
