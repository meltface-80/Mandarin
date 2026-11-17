// IBroadcastUploadChoices.cs — what the upload to iBroadcast sends and how hard it pushes (item 451), as its page sets
// them (the setting "ibroadcastUploadSettings"):
//   - Upload from: all the music, or one drive: every drive connected (item 455: each folder under the music folder's
//     USB, where Mandarin OS mounts USB drives, and its Internal disk), whether or not it is one of the music folders,
//     and each folder at the top of a music folder the library has files in. A drive's files are sent from the drive
//     (IBroadcastUploadLocal.cs), known to the library or not. Nothing chosen at first: Upload now and the schedule
//     wait for a choice;
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
    /// <summary>Upload from: everything.</summary>
    public const string All = "all";

    /// <summary>The choices: [From] null (none chosen), "all" or a drive's folder; how many at once, and when music plays.</summary>
    public sealed record Choices(string? From, int AtOnce, bool Home, int HomeAtOnce, bool Away, int AwayAtOnce);

    /// <summary>A drive offered: its folder, its name as the page says it, and how many of the library's files are on it (null: one connected, not counted).</summary>
    public sealed record Source(string Path, string Name, long? Files);

    /// <summary>The choices as kept, each defaulted.</summary>
    public static Choices Stored()
    {
        using var c = Db.Open();
        var o = Db.Setting(c, Key) as JsonObject;
        return new(IBroadcastApi.Str(o?["from"]), Count(o?["at_once"], 3), Flag(o?["home"]), Count(o?["home_at_once"], 3), Flag(o?["away"]), Count(o?["away_at_once"], 1));
    }

    /// <summary>The choices as the page reads them.</summary>
    public static JsonObject Json(Choices c) => new()
    {
        ["from"] = c.From, ["from_name"] = NameOf(c.From), ["at_once"] = c.AtOnce, ["home"] = c.Home, ["home_at_once"] = c.HomeAtOnce,
        ["away"] = c.Away, ["away_at_once"] = c.AwayAtOnce,
    };

    /// <summary>Changed by [patch] (any of the choices): kept, or why not.</summary>
    public static (Choices? Kept, string? Refused) Save(JsonObject patch)
    {
        var c = Stored();
        if (patch.ContainsKey("from"))
        {
            var from = IBroadcastApi.Str(patch["from"]);
            if (from != All && !Sources().Any(s => s.Path == from)) return (null, "Upload from must be All music or one of the drives offered");
            c = c with { From = from };
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

    /// <summary>What [from] is called: "All music", a drive's name, or null (none chosen).</summary>
    public static string? NameOf(string? from) => from == null ? null : from == All ? "All music" : Path.GetFileName(from);

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
