// AlbumScanner.cs — Settings → Library Scanner → Album Scanner (bug list item 411): one switch over the album
// scanning that four switches set before it (Identify albums, Ask iTunes too, Measure ReplayGain, Find covers):
// identification, iTunes asked too (Identifier.cs), ReplayGain measured (Loudness.cs) and the cover finder
// (Extras/AutoCovers.cs). On, all three run; off, none of them does. The library's own scan of the music folders,
// which finds the music, isn't the album scanner's and keeps running either way (Scans.cs).
//
// When: in the schedule's hours, Scheduling's (Identifier.Stored: on, between its start and end times on the
// server's clock; off, any time, day and night); never while the library is scanned; and never while music plays
// (a room or a phone playing, or a track being made as it plays): no album is started then, and the one under way
// is finished.
//
// The switch is kept as the setting "albumScanner". Never set (a server from before it): on when any of the four
// switches before it was on, each read with its own default. The old switches' requests are taken as this one's
// (IdentifyRoutes.cs, Waveforms.cs, AutoCoverRoutes.cs): enabled, measure and on set it; itunes is no longer a
// choice (asked whenever the scanner is on) and is ignored.
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static class AlbumScanner
{
    private const string Key = "albumScanner";

    /* On or off: as kept, or, never set, as the four switches before it were. */
    public static bool On()
    {
        try
        {
            using var c = Db.Open();
            if (Db.Setting(c, Key) is JsonValue v && v.TryGetValue<bool>(out var on)) return on;
            return Before(Db.Setting(c, "identify"), Db.Setting(c, "replaygain"), Db.Setting(c, "autoCovers"));
        }
        catch (Microsoft.Data.Sqlite.SqliteException) { return false; }
    }

    /*
     * The four switches before this one, each with its own default (Identify albums on, Ask iTunes too on, Measure
     * ReplayGain off, Find covers on): on when any of them was.
     */
    public static bool Before(JsonNode? identify, JsonNode? replaygain, JsonNode? autoCovers)
    {
        static bool Said(JsonNode? o, string k, bool d) => o is JsonObject j && j[k] is JsonValue v ? v.TryGetValue<bool>(out var b) ? b : d : d;
        var covers = autoCovers is JsonValue cv && cv.TryGetValue<bool>(out var cb) ? cb : true;
        return Said(identify, "enabled", true) || Said(identify, "itunes", true) || Said(replaygain, "measure", false) || covers;
    }

    /* Switched on or off: kept, and each job told (the measuring started or stopped, the cover finder run). */
    public static void Set(bool on)
    {
        using (var c = Db.Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$k", Key);
            cmd.Parameters.AddWithValue("$v", on ? "true" : "false");
            cmd.ExecuteNonQuery();
        }
        if (Jobs.Loudness is { } l) { if (on) l.Start(); else l.Stop(); }
        AutoCovers.Current?.Switched(on);
        AlbumProgress.Forget();
    }

    /* Scheduling's hours moved, or Scheduling switched: the cover finder's run put off till then, made if it may be now. */
    public static void HoursMoved()
    {
        AutoCovers.Current?.HoursMoved();
        AlbumProgress.Forget();
    }

    /* Inside the schedule's hours (Scheduling off: always). */
    public static bool InHours()
    {
        var s = Identifier.Stored();
        return !Js.Truthy(s["schedule"]) || Identifier.InWindow(s);
    }

    /* Music playing: a room or a phone playing (or loading its track) as last heard (Playback/Hub.Heard.cs), or a track being made as it plays. */
    public static bool Playing() => (Playback.Hub.Current?.PlayingNow() ?? 0) > 0 || Cpu.MakingNow;
}
