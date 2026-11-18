// IBroadcastUploadChoices.cs — what the upload to iBroadcast sends and how hard it pushes (item 451), as its page sets
// them (the setting "ibroadcastUploadSettings"):
//   - Upload from: All drives, or any of the drives, one or several (item 472): every drive connected (item 455: each
//     folder under the music folder's USB, where Mandarin OS mounts USB drives, and its Internal disk), whether or not
//     it is one of the music folders, and each folder at the top of a music folder the library has files in. A drive's
//     files are sent from the drive (IBroadcastUploadLocal.cs), known to the library or not, a file once however many
//     of the drives chosen hold it. All drives is every drive offered as the upload begins, those connected since
//     included (it was All music, the library's files alone: none, where the drives were no longer music folders).
//     Nothing chosen at first: Upload now and the schedule wait for a choice;
//   - files at once with nothing playing, 1 to 3 (3); while music plays at home, none unless switched on, then 1 to 3
//     (3); while a phone plays away from home, none unless switched on, then 1 to 3 (1). Away from home wins where both
//     play: what plays there comes over the home's upload, which the upload shares. Three at most: iBroadcast says no
//     limit, and its own Android uploader sends three at once.
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastUploadChoices
{
    /// <summary>{ from, at_once, home, home_at_once, away, away_at_once }.</summary>
    public const string Key = "ibroadcastUploadSettings";
    /// <summary>The most files sent at once.</summary>
    public const int Most = 3;
    /// <summary>Upload from: every drive.</summary>
    public const string All = "all";
    /// <summary>What "from" says where several drives are chosen (their folders in "drives").</summary>
    public const string Several = "drives";

    /// <summary>The choices: every drive ([All]), or the [Drives] chosen (their folders; none: nothing chosen); how many at once, and when music plays.</summary>
    public sealed record Choices(bool All, IReadOnlyList<string> Drives, int AtOnce, bool Home, int HomeAtOnce, bool Away, int AwayAtOnce)
    {
        /// <summary>Whether anything is chosen to upload from.</summary>
        public bool Chosen => All || Drives.Count > 0;

        /// <summary>"from" as an app before item 472 reads it: "all", the one drive's folder, "drives" for several, or null.</summary>
        public string? From => All ? IBroadcastUploadChoices.All : Drives.Count == 1 ? Drives[0] : Drives.Count > 1 ? Several : null;
    }

    /// <summary>A drive offered: its folder, its name as the page says it, and how many of the library's files are on it (null: one connected, not counted).</summary>
    public sealed record Source(string Path, string Name, long? Files);

    /// <summary>The choices as kept, each defaulted.</summary>
    public static Choices Stored()
    {
        using var c = Db.Open();
        var o = Db.Setting(c, Key) as JsonObject;
        // "from": "all", or the drives' folders; one drive's folder alone as it was kept before item 472.
        var from = o?["from"];
        var all = IBroadcastApi.Str(from) == All;
        var drives = from is JsonArray a ? a.Select(IBroadcastApi.Str).OfType<string>().Distinct().ToList()
            : IBroadcastApi.Str(from) is { } one && one != All && one != Several ? [one] : new List<string>();
        return new(all, drives, Count(o?["at_once"], 3), Flag(o?["home"]), Count(o?["home_at_once"], 3), Flag(o?["away"]), Count(o?["away_at_once"], 1));
    }

    /// <summary>The choices as the page reads them.</summary>
    public static JsonObject Json(Choices c) => new()
    {
        ["from"] = c.From, ["drives"] = new JsonArray([.. c.Drives.Select(d => (JsonNode)d)]), ["from_name"] = NameOf(c), ["at_once"] = c.AtOnce,
        ["home"] = c.Home, ["home_at_once"] = c.HomeAtOnce, ["away"] = c.Away, ["away_at_once"] = c.AwayAtOnce,
    };

    /// <summary>Changed by [patch] (any of the choices): kept, or why not.</summary>
    public static (Choices? Kept, string? Refused) Save(JsonObject patch)
    {
        var c = Stored();
        // "from": "all", null (nothing), or one drive's folder; "drives": the drives' folders, any number (none: nothing).
        if (patch.ContainsKey("from"))
        {
            var from = IBroadcastApi.Str(patch["from"]);
            if (from == All) c = c with { All = true, Drives = [] };
            else if (from == null) c = c with { All = false, Drives = [] };
            else if (Sources().Any(s => s.Path == from)) c = c with { All = false, Drives = [from] };
            else return (null, "Upload from must be All drives or the drives offered");
        }
        if (patch.ContainsKey("drives"))
        {
            if (patch["drives"] is not JsonArray list || list.Any(x => IBroadcastApi.Str(x) is null)) return (null, "drives must be a list of the drives offered");
            // Those offered, and those already chosen (a drive chosen and unplugged stays chosen until it is taken off).
            var offered = Sources().Select(s => s.Path).Concat(c.Drives).Distinct().ToList();
            var drives = list.Select(x => IBroadcastApi.Str(x)!).Distinct().ToList();
            if (drives.Any(d => !offered.Contains(d))) return (null, "Upload from must be All drives or the drives offered");
            // In the order they are offered, as the page lists them, however they were tapped.
            c = c with { All = false, Drives = [.. drives.OrderBy(offered.IndexOf)] };
        }
        foreach (var k in new[] { "at_once", "home_at_once", "away_at_once" })
        {
            if (!patch.ContainsKey(k)) continue;
            if (patch[k] is not JsonValue v || !v.TryGetValue<double>(out var n) || n != Math.Floor(n) || n < 1 || n > Most) return (null, $"{k} must be 1 to {Most}");
            c = k switch { "at_once" => c with { AtOnce = (int)n }, "home_at_once" => c with { HomeAtOnce = (int)n }, _ => c with { AwayAtOnce = (int)n } };
        }
        foreach (var k in new[] { "home", "away" })
        {
            if (!patch.ContainsKey(k)) continue;
            if (patch[k] is not JsonValue v || !v.TryGetValue<bool>(out var on)) return (null, k + " must be true or false");
            c = k == "home" ? c with { Home = on } : c with { Away = on };
        }
        using (var db = Db.Open())
        using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$k", Key);
            var kept = Json(c);
            kept.Remove("from_name");
            kept.Remove("drives");
            kept["from"] = c.All ? All : new JsonArray([.. c.Drives.Select(d => (JsonNode)d)]);
            cmd.Parameters.AddWithValue("$v", kept.ToJsonString());
            cmd.ExecuteNonQuery();
        }
        return (c, null);
    }

    /// <summary>
    /// The drives offered: each folder at the top of a music folder that the library has files in (hidden ones and
    /// lost+found left out), by name; where there are several music folders, each named with its own.
    /// </summary>
    public static List<Source> Sources()
    {
        var roots = Scans.Roots();
        var list = new List<Source>();
        // Every drive connected, music folder or not (item 455): Mandarin OS mounts each USB drive under <music>/USB, its
        // own disk at <music>/Internal.
        var storage = Scans.MusicDir;
        string[] usb;
        try { usb = Directory.GetDirectories(Path.Combine(storage, "USB")); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { usb = []; }
        foreach (var d in usb.Order(StringComparer.OrdinalIgnoreCase))
            if (Path.GetFileName(d) is var name && !name.StartsWith('.') && name != "lost+found") list.Add(new(d, name, null));
        var inside = Path.Combine(storage, "Internal");
        try { if (Directory.Exists(inside) && Directory.EnumerateFileSystemEntries(inside).Any()) list.Add(new(inside, "Internal", null)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* not mounted, or not ours to read */ }
        using var c = Db.Open();
        foreach (var root in roots)
        {
            string[] dirs;
            try { dirs = Directory.GetDirectories(root); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            foreach (var d in dirs.Order(StringComparer.OrdinalIgnoreCase))
            {
                var name = Path.GetFileName(d);
                if (name.StartsWith('.') || name == "lost+found") continue;
                using var cmd = c.CreateCommand();
                cmd.CommandText = "SELECT COUNT(DISTINCT path) FROM tracks WHERE substr(path, 1, $n) = $p";
                cmd.Parameters.AddWithValue("$n", d.Length + 1);
                cmd.Parameters.AddWithValue("$p", d + "/");
                var files = Convert.ToInt64(cmd.ExecuteScalar() ?? 0L, System.Globalization.CultureInfo.InvariantCulture);
                if (files > 0 && !list.Any(s => s.Path == d)) list.Add(new(d, roots.Count > 1 ? $"{name} ({Path.GetFileName(root)})" : name, files));
            }
        }
        return list;
    }

    /// <summary>The drives offered, as the page reads them: [{ path, name, files }]; kept half a minute, the page asking every two seconds while an upload goes.</summary>
    public static JsonArray SourcesJson()
    {
        lock (Gate) if (kept is { } k && DateTime.UtcNow - k.At < TimeSpan.FromSeconds(30)) return (JsonArray)k.List.DeepClone();
        var list = new JsonArray([.. Sources().Select(s => (JsonNode)new JsonObject { ["path"] = s.Path, ["name"] = s.Name, ["files"] = s.Files })]);
        lock (Gate) kept = (DateTime.UtcNow, list);
        return (JsonArray)list.DeepClone();
    }

    private static readonly object Gate = new();
    private static (DateTime At, JsonArray List)? kept;

    /// <summary>What [c] uploads from is called: "All drives", the drives' names, or null (none chosen).</summary>
    public static string? NameOf(Choices c) => c.All ? "All drives" : c.Drives.Count == 0 ? null : string.Join(", ", c.Drives.Select(NameOf));

    /// <summary>A drive's name: its folder's.</summary>
    public static string NameOf(string drive) => Path.GetFileName(drive);

    /// <summary>
    /// The drives [c] uploads from now: All drives' every drive offered, else those chosen; each connected (one that
    /// isn't in [missing]), and one inside another left to it (Mandarin OS's USB folder holds its drives).
    /// </summary>
    public static List<string> DrivesNow(Choices c, out List<string> missing)
    {
        var wanted = c.All ? Sources().Select(s => s.Path).ToList() : [.. c.Drives];
        missing = [.. wanted.Where(d => !Directory.Exists(d))];
        var here = wanted.Where(Directory.Exists).Distinct().ToList();
        return [.. here.Where(d => !here.Any(o => o != d && d.StartsWith(o.TrimEnd('/') + "/", StringComparison.Ordinal)))];
    }

    /// <summary>
    /// How many files may be sent at once now under [c], and where music plays that holds it to none ("home", "away"),
    /// or null where it doesn't: a phone away from home playing (its own rule), else a room, a phone at home or a track
    /// being made as it plays (the home's), else nothing playing.
    /// </summary>
    public static (int Most, string? Held) Allowed(Choices c)
    {
        var hub = Playback.Hub.Current;
        var heard = hub?.Holding() ?? [];
        bool Away(Playback.Heard h) => h.Kind == "phone" && hub!.Phones.IsAway(h.Id);
        if (heard.Any(Away)) return c.Away ? (c.AwayAtOnce, null) : (0, "away");
        if (Cpu.MakingNow || heard.Count > 0) return c.Home ? (c.HomeAtOnce, null) : (0, "home");
        return (c.AtOnce, null);
    }

    private static int Count(JsonNode? n, int or) => n is JsonValue v && v.TryGetValue<double>(out var d) && d >= 1 && d <= Most ? (int)d : or;
    private static bool Flag(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) && b;
}
