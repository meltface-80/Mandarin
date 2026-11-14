// ScannerHeld.cs — what holds the Album Scanner (bug list item 417b): the rooms and phones playing Mandarin's music
// (Playback/Hub.Heard.cs), and a track made as it plays (Cpu.Making.cs), by name, for Settings → Library Scanner's
// readout ("Paused while music plays in Living room") and GET /api/album-scanner's holding. The log says when it is
// held, by what, and when it goes on again, once each, not at every ask:
//
//   [scanner] held: Living room playing (the Sonos says PLAYING since 19:22:41, last heard 3 s ago)
//   [scanner] going on: nothing playing
//
// Before, "Paused while music plays" said nothing of what played, and neither the owner nor the log could tell.
using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Identify;

internal static class ScannerHeld
{
    /*
     * One thing holding it: [Kind] room, phone or making; [Name] the room's or phone's (a making's: the room it is made
     * for, null where not known); [State] playing, loading or making; [Since] when it came to that, [At] when last heard
     * (a making: when it last made more or had more read), ms; [Track] a making's track; [Says] what said it.
     */
    public sealed record Holder(string Kind, string? Name, string State, double Since, double At, string? Track, string Says);

    private static readonly object gate = new();
    private static string? said;   // what the last "held" line named; null while it goes on

    /* What holds it now: none while nothing plays. Its log line where that is new. */
    public static List<Holder> Now()
    {
        var hub = Playback.Hub.Current;
        var list = (hub?.Holding() ?? []).Select(h => new Holder(h.Kind, h.Name, h.State, h.Since, h.At, null, h.Says)).ToList();
        if (Cpu.MakingNow) list.Add(Making(hub));
        Said(list);
        return list;
    }

    // The making: its track, and the room it is for where one is on that track.
    private static Holder Making(Playback.Hub? hub)
    {
        var at = Playback.Hub.Now();
        if (Cpu.MakingWhat is not { } w) return new Holder("making", null, "making", at, at, null, "a making");
        var heard = at - w.QuietMs;
        return new Holder("making", hub?.PlayingTrack(w.TrackId), "making", heard, heard, w.Name, "a making");
    }

    /* Switched off: what held it forgotten, said again if it holds it once on. */
    public static void Forget() { lock (gate) said = null; }

    // Held by something new, or let go: one line.
    private static void Said(List<Holder> list)
    {
        var key = list.Count == 0 ? null : string.Join("|", list.Select(h => h.Kind + ":" + h.Name + ":" + h.Track));
        lock (gate)
        {
            if (key == said) return;
            said = key;
        }
        Server.Log(key == null ? "[scanner] going on: nothing playing" : "[scanner] held: " + string.Join("; ", list.Select(Line)));
    }

    /* "Living room playing (the Sonos says PLAYING since 19:22:41, last heard 3 s ago)"; a making: "a track made as it plays (01 Long, for Living room; last made or read 1 s ago)". */
    public static string Line(Holder h)
    {
        var ago = Math.Max(0, Math.Round((Playback.Hub.Now() - h.At) / 1000)).ToString(CultureInfo.InvariantCulture);
        if (h.Kind == "making")
            return "a track made as it plays (" + (h.Track ?? "its track") + (h.Name != null ? ", for " + h.Name : "") + "; last made or read " + ago + " s ago)";
        var since = DateTimeOffset.FromUnixTimeMilliseconds((long)h.Since).UtcDateTime.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
        return h.Name + " " + h.State + " (" + h.Says + " since " + since + ", last heard " + ago + " s ago)";
    }

    /* As GET /api/album-scanner gives them: [{ kind, name, state, since, heard, track }], ms. */
    public static JsonArray Json(IEnumerable<Holder> list) => new(list.Select(h => (JsonNode)new JsonObject
    {
        ["kind"] = h.Kind, ["name"] = h.Name, ["state"] = h.State, ["since"] = (long)h.Since, ["heard"] = (long)h.At, ["track"] = h.Track
    }).ToArray());
}
