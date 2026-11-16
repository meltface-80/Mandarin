// IBroadcastSchedule.cs — the upload to iBroadcast on a schedule (item 447): a window each day, on the server's clock,
// set on iBroadcast's page (the setting "ibroadcastUploadSchedule": { on, start, end }, off until set). As the window
// opens the upload begins (IBroadcastUpload.cs), once a window, going on where the last one stopped; as it closes,
// one the schedule began is stopped after the file it is on. Upload now still uploads at any time.
//
// Never at the Library Scanner's hours (Identifier.Stored: its Schedule, start and end): the two can't be set to
// overlap, from either page. An upload window that would is refused, saying the scanner's hours; so is one while the
// scanner has no hours (its Schedule off: it may run at any time). Likewise the scanner's hours, or its Schedule off,
// where an upload window is set (AlbumScannerRoutes.cs). Each page says the other's hours.
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Identify;

namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcastSchedule(IBroadcastUpload upload)
{
    /// <summary>The window: { on, start, end }.</summary>
    public const string Key = "ibroadcastUploadSchedule";
    /// <summary>How often the clock is looked at (the tests' shorter).</summary>
    public int TickMs { get; init; } = 30_000;

    private Timer? timer;
    private bool inside, began;

    /// <summary>The window as kept: off, 22:00 to 01:00, until set.</summary>
    public static JsonObject Stored()
    {
        using var c = Db.Open();
        var kept = Db.Setting(c, Key) as JsonObject;
        return new JsonObject
        {
            ["on"] = kept?["on"] is JsonValue v && v.TryGetValue<bool>(out var on) && on,
            ["start"] = IBroadcastApi.Str(kept?["start"]) ?? "22:00",
            ["end"] = IBroadcastApi.Str(kept?["end"]) ?? "01:00",
        };
    }

    /// <summary>The Library Scanner's hours as its page has them: { on (its Schedule), start, end }.</summary>
    public static JsonObject ScannerHours()
    {
        var s = Identifier.Stored();
        return new JsonObject { ["on"] = Tags.Js.Truthy(s["schedule"]), ["start"] = Tags.Js.Str(s["start"]), ["end"] = Tags.Js.Str(s["end"]) };
    }

    /// <summary>The window changed ([patch]: on, start, end, each where given): the window kept, or why not.</summary>
    public static (JsonObject? Kept, string? Refused) Save(JsonObject patch)
    {
        var w = Stored();
        if (patch["on"] is JsonValue o && o.TryGetValue<bool>(out var on)) w["on"] = on;
        foreach (var k in new[] { "start", "end" })
        {
            if (!patch.ContainsKey(k)) continue;
            var t = IBroadcastApi.Str(patch[k]) ?? "";
            if (Minutes(t) is null) return (null, k + " must be a time like 01:00");
            w[k] = t;
        }
        if (Overlap(w, ScannerHours()) is { } why) return (null, why);
        using (var c = Db.Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$k", Key);
            cmd.Parameters.AddWithValue("$v", w.ToJsonString());
            cmd.ExecuteNonQuery();
        }
        Server.Log($"[ibroadcast] upload schedule: {(Jv(w, "on") ? $"{w["start"]}–{w["end"]}" : "off")}");
        return (w, null);
    }

    /// <summary>
    /// Why the upload [window] can't be kept beside the Library Scanner's [scanner] hours (each { on, start, end }), or
    /// null where it can: off, it overlaps nothing.
    /// </summary>
    public static string? Overlap(JsonObject window, JsonObject scanner)
    {
        if (!Jv(window, "on")) return null;
        string ws = T(window, "start"), we = T(window, "end");
        if (ws == we) return "The upload window's start and end are the same time: give it some hours";
        if (!Jv(scanner, "on"))
            return "The Library Scanner has no hours (its Schedule is off), so it may run at any time and an upload window would overlap it. Give the Library Scanner hours first, in Settings → Library Scanner";
        string ss = T(scanner, "start"), se = T(scanner, "end");
        return Meet(ws, we, ss, se) ? $"The upload window {ws}–{we} overlaps the Library Scanner's hours, {ss}–{se}: choose hours outside them" : null;
    }

    /// <summary>Whether the windows [a1]–[a2] and [b1]–[b2] (a window over midnight counts; start and end the same, none) share a minute.</summary>
    public static bool Meet(string a1, string a2, string b1, string b2)
    {
        var a = Spans(a1, a2);
        var b = Spans(b1, b2);
        return a.Any(x => b.Any(y => x.From < y.To && y.From < x.To));
    }

    /* A window as the minutes of the day it holds, split at midnight. */
    private static List<(int From, int To)> Spans(string start, string end)
    {
        int s = Minutes(start) ?? 0, e = Minutes(end) ?? 0;
        return s == e ? [] : s < e ? [(s, e)] : [(s, 24 * 60), (0, e)];
    }

    /// <summary>"HH:MM" as minutes of the day; null where it isn't one.</summary>
    public static int? Minutes(string t)
    {
        var p = t.Split(':');
        return p.Length == 2 && p[1].Length == 2 && int.TryParse(p[0], NumberStyles.None, CultureInfo.InvariantCulture, out var h)
            && int.TryParse(p[1], NumberStyles.None, CultureInfo.InvariantCulture, out var m) && h < 24 && m < 60 ? h * 60 + m : null;
    }

    /// <summary>Whether [at] (now) is inside [window]'s hours.</summary>
    public static bool Inside(JsonObject window, DateTime? at = null)
    {
        var d = at ?? DateTime.Now;
        var t = d.Hour * 60 + d.Minute;
        return Spans(T(window, "start"), T(window, "end")).Any(x => t >= x.From && t < x.To);
    }

    /// <summary>The clock looked at now and every half minute.</summary>
    public void Start() => timer = new Timer(_ => Tick(), null, TimeSpan.FromMilliseconds(Math.Min(5000, TickMs)), TimeSpan.FromMilliseconds(TickMs));

    /// <summary>Stopped.</summary>
    public void Stop() => timer?.Dispose();

    /* The window opened: the upload begun, once; closed (or switched off): one the schedule began, stopped. */
    private void Tick()
    {
        try
        {
            var w = Stored();
            var now = Jv(w, "on") && IBroadcast.Connected() && Inside(w);
            if (now && !inside)
            {
                // Nothing chosen to upload from (item 451): said once, at the window's opening.
                var from = IBroadcastUploadChoices.Stored().From;
                began = !upload.Running && from != null;
                if (began) { Server.Log("[ibroadcast] upload schedule: the window opened, the upload begun"); upload.Start(); }
                else if (from == null) Server.Log("[ibroadcast] upload schedule: the window opened, but nothing is chosen to upload from");
            }
            else if (!now && inside && began)
            {
                began = false;
                if (upload.Running) { Server.Log("[ibroadcast] upload schedule: the window closed, the upload stopped"); upload.Stop(); }
            }
            inside = now;
        }
        catch (Exception e) when (e is ServiceError or Microsoft.Data.Sqlite.SqliteException) { Server.Log("[ibroadcast] upload schedule: " + e.Message); }
    }

    private static string T(JsonObject o, string k) => IBroadcastApi.Str(o[k]) ?? "";

    private static bool Jv(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
}
