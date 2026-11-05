// SqToolRecord.cs — SQ-tool's recording of a Mandarin zone (item 290): the proof that what reaches a DAC is the
// file. SQ-tool's page (SqTool.cs, /sq-tool/) has a song chosen and a zone; Mandarin plays the song there alone, from
// its start, and records exactly what the zone's DAC is fed, the whole track (BitPerfect/Check.cs's recording: a
// Mandarin Bridge at its /capture, in parts joined into one, or a USB DAC on this server off its bus), and hands the
// recording to SQ-tool (its POST /api/tests/<id>/recording), which compares it with the song and draws its charts.
// One recording at a time: GET /api/sq-tool/record says where it is; /api/sq-tool/zones, which zones can be recorded.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.BitPerfect;
using Mandarin.Server.Playback;

namespace Mandarin.Server;

internal static class SqToolRecord
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(30) };
    private static readonly object gate = new();
    private static Job? job;

    // Where a recording is made before it goes to SQ-tool: emptied for each, gone once handed over.
    private static string Dir => Path.Combine(Server.DataDir, "sq-tool-recording");

    /* A recording: of SQ-tool's test [Test], on zone [Zone] (named [Name]), of a song [Seconds] long. */
    private sealed record Job(string Test, string Zone, string Name, double Seconds)
    {
        public readonly Check.Run Run = new();
    }

    /* Every room but the phones, and whether what its DAC is fed can be recorded; why not, where it can't. */
    public static async Task<JsonObject> Zones(Hub hub)
    {
        var list = new JsonArray();
        foreach (var z in hub.Zones().Where(z => !z.IsPhone))
        {
            var why = hub.IsUpnp(z.ZoneId) ? (await hub.Upnp.RecorderFor(z.ZoneId, Dir)).Why
                : "Only Mandarin Bridge, or a USB DAC on Mandarin's server, can record what its DAC is fed";
            list.Add(new JsonObject { ["zone_id"] = z.ZoneId, ["name"] = z.DisplayName, ["can"] = why.Length == 0, ["why"] = why.Length == 0 ? null : why });
        }
        return new JsonObject { ["zones"] = list };
    }

    /* The recording under way, or the last one: where it is. */
    public static JsonObject State()
    {
        Job? j;
        lock (gate) j = job;
        if (j == null) return new JsonObject { ["state"] = "none" };
        return new JsonObject
        {
            ["state"] = j.Run.State, ["says"] = j.Run.Said, ["test"] = j.Test, ["zone"] = j.Zone, ["name"] = j.Name,
            ["recorded"] = Math.Round(Math.Max(j.Run.Recorded, j.Run.Recording), 1), ["seconds"] = Math.Round(j.Seconds, 1),
        };
    }

    /* The recording under way stopped. */
    public static void Stop()
    {
        lock (gate) job?.Run.Stop.Cancel();
    }

    /* SQ-tool's test [test]'s song played on zone [zone] and recorded: begun, or the status and why not. */
    public static async Task<(int Status, JsonObject Body)> Start(Hub hub, string test, string zone)
    {
        lock (gate) if (job?.Run.State is "starting" or "recording" or "handing") return (409, Err("A recording is already under way"));
        if (!hub.IsUpnp(zone)) return (400, Err("Only Mandarin Bridge, or a USB DAC on Mandarin's server, can record what its DAC is fed"));
        if (await SqTool.Local() is not { } sq) return (503, Err("SQ-tool isn't running: " + SqTool.Why));
        JsonObject? t;
        using (var r = await Http.GetAsync(new Uri(sq, "api/tests/" + Uri.EscapeDataString(test))))
            t = r.IsSuccessStatusCode ? JsonNode.Parse(await r.Content.ReadAsStringAsync()) as JsonObject : null;
        if (t == null) return (404, Err("SQ-tool has no such test"));
        if (t["source"] is not JsonObject src || (string?)src["state"] != "ready") return (409, Err("SQ-tool hasn't read the song yet"));
        if (await Track((string?)src["music_path"] ?? "") is not { } track)
            return (404, Err("This song isn't in Mandarin's library, so Mandarin can't play it: choose one Mandarin has scanned"));
        var (recorder, why) = await hub.Upnp.RecorderFor(zone, Dir);
        if (recorder == null) return (409, Err(why));
        var j = new Job(test, zone, hub.Upnp.NameOf(zone), track.Duration);
        lock (gate)
        {
            if (job?.Run.State is "starting" or "recording" or "handing") return (409, Err("A recording is already under way"));
            job = j;
        }
        _ = Task.Run(() => Go(hub, j, track, recorder, sq));
        return (200, State());
    }

    // The library's track at [rel] under the music folder: what Mandarin plays.
    private static async Task<PlayTrack?> Track(string rel)
    {
        var root = Path.GetFullPath(Scans.MusicDir);
        var full = Path.GetFullPath(Path.Combine(root, rel));
        if (rel.Length == 0 || !full.StartsWith(root.TrimEnd('/') + "/", StringComparison.Ordinal)) return null;
        if (await Library.CurrentCopy() is not { } s) return null;
        using var c = Db.Open();
        using var q = c.CreateCommand();
        q.CommandText = "SELECT id FROM tracks WHERE path = $p";
        q.Parameters.AddWithValue("$p", full);
        return q.ExecuteScalar() is long n ? Tracks.Of(c, s, n) : null;
    }

    // [j]: [track] played on its zone alone from its start, recorded whole by [recorder], handed to SQ-tool at [sq].
    private static async Task Go(Hub hub, Job j, PlayTrack track, IRecorder recorder, Uri sq)
    {
        var run = j.Run;
        var ct = run.Stop.Token;
        var failed = true;
        var stream = new Regex($@"/stream/t{track.Id}(\.|\?|$)");
        var room = new Check.Room(async () => await Items.PlayTracks(hub, j.Zone, [track], "play_now"),
            () => stream.IsMatch(hub.StateOf(j.Zone)?.TrackUri ?? ""), j.Name);
        try
        {
            var parts = await Check.Recorded(run, track.Duration, room, recorder, Dir, ct);
            if (parts.Count != 1) throw new InvalidOperationException("its parts don't follow on, so they aren't one recording of the track");
            run.State = "handing";
            run.Said = "Handing the recording to SQ-tool";
            await Hand(sq, j, parts[0].Wav, recorder is UsbRecorder ? "Mandarin's server, off the USB bus" : "Mandarin Bridge", ct);
            failed = false;
            run.State = "done";
            run.Said = "Recorded: SQ-tool is comparing it with the song";
        }
        // A recording or a hand-over that fails, whatever the fault: said, never a recording left under way.
        catch (Exception e) when (e is HttpRequestException or IOException or OperationCanceledException or InvalidOperationException or TimeoutException
            or UnauthorizedAccessException or ArgumentException or IndexOutOfRangeException or OverflowException or FormatException or System.Text.Json.JsonException)
        {
            run.State = "failed";
            run.Said = ct.IsCancellationRequested ? "Stopped" : "The recording couldn't be made: " + e.Message;
        }
        finally
        {
            if (failed) await recorder.Stop(true);
            try { Directory.Delete(Dir, true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* left for the next */ }
        }
        Server.Log($"[sq-tool] {j.Name}, {track.Title}: {run.Said}");
    }

    // The recording at [wav] posted to SQ-tool's test, its length given (Python's server reads a body by it).
    private static async Task Hand(Uri sq, Job j, string wav, string device, CancellationToken ct)
    {
        await using var f = File.OpenRead(wav);
        using var body = new StreamContent(f);
        body.Headers.ContentLength = f.Length;
        body.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
        var at = $"api/tests/{Uri.EscapeDataString(j.Test)}/recording?zone={Uri.EscapeDataString(j.Name)}&device={Uri.EscapeDataString(device)}";
        using var r = await Http.PostAsync(new Uri(sq, at), body, ct);
        if (!r.IsSuccessStatusCode) throw new HttpRequestException("SQ-tool refused it: " + await r.Content.ReadAsStringAsync(ct));
    }

    private static JsonObject Err(string message) => new() { ["error"] = message };
}
