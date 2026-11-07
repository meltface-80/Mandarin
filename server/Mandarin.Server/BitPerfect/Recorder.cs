// Recorder.cs — what records what a DAC is fed, for the bit-perfect check (bug list item 275): a Mandarin Bridge at its
// /capture (DeviceRecorder, here; a DAC on this server is a Mandarin Bridge's, item 324). It is asked to record,
// waited for, and its recording taken as a WAV with its sidecar's "capture" (Recording.cs reads them).
using System.Text.Json.Nodes;

namespace Mandarin.Server.BitPerfect;

/* One recorder of what a DAC is fed. */
internal interface IRecorder
{
    /* The most one recording holds, in seconds: a longer track is recorded in turn. */
    int Most { get; }

    /* Record [seconds] from the start of the next stream (the first ask), or straight on (each ask after). */
    Task Ask(int seconds, CancellationToken ct);

    /* Until this recording is over: the seconds it holds, and whether it ran as long as asked. */
    Task<(double Seconds, bool Whole)> Wait(Check.Run run, double before, CancellationToken ct);

    /* The recording written to [wav]: its sidecar's "capture", or null (PCM). */
    Task<JsonObject?> Take(string wav, CancellationToken ct);

    /* Recording stopped; [failed] where the check didn't finish. */
    Task Stop(bool failed);

    /* Whether parts of this recording are still to come (a recording in parts): the check waits for them all. */
    bool More => false;
}

/*
 * A Mandarin Bridge renderer's /capture (github.com/meltface-80/Android-USB-Driver), at its base address [device].
 * Where its /dac.json says "capture_parts" ([parts], item 286), one recording runs the whole track: begun on the
 * stream played again from its start ("after_flush", so its first second isn't lost to the recording before it), kept
 * in parts of [Part] seconds one after another with not a byte between them, each fetched and let go as it is done.
 * An older app records up to two minutes at a time, asked again after each, the moments between them unrecorded.
 */
internal sealed class DeviceRecorder(string device, bool parts = false) : IRecorder
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    /* The seconds in each part of a recording in parts. */
    public const int Part = 60;

    private bool asked;
    private int next = 1;
    private bool more;

    public bool More => more;

    public int Most => parts ? 24 * 3600 : Check.Most;

    public async Task Ask(int seconds, CancellationToken ct)
    {
        // In parts, one ask records the whole track: the asks after it are already under way.
        if (parts && asked) return;
        var body = new JsonObject { ["seconds"] = seconds };
        if (parts) { body["part"] = Part; body["after_flush"] = true; }
        // With its length (item 292): the Bridge reads a body by its Content-Length, so one sent in chunks is heard as
        // no ask at all, and it records 30 seconds in one piece.
        using var ask = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json");
        using var r = await Http.PostAsync(device + "/capture", ask, ct);
        var said = await r.Content.ReadAsStringAsync(ct);
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException($"the device wouldn't record (HTTP {(int)r.StatusCode}: {said.Trim()})");
        // What it says it took: in parts, as asked, or it says so now rather than when its one piece ends.
        if (parts && (JsonNode.Parse(said) as JsonObject)?["part_seconds"] is JsonValue p && Check.Number(p) <= 0)
            throw new InvalidOperationException("the device didn't take the recording as asked: it would record in one piece, not the whole track in parts");
        asked = true;
    }

    public async Task<(double Seconds, bool Whole)> Wait(Check.Run run, double before, CancellationToken ct)
    {
        var armedSince = DateTime.UtcNow;
        while (true)
        {
            await Task.Delay(1000, ct);
            var st = JsonNode.Parse(await Http.GetStringAsync(device + "/capture", ct)) as JsonObject ?? [];
            var state = (string?)st["state"];
            var rate = Math.Max(1, Check.Number(st["rate"]));
            var seconds = Check.Number(st["frames"]) / rate;
            if (parts)
            {
                var done = (st["parts"] as JsonArray ?? []).OfType<JsonObject>().ToList();
                if (done.FirstOrDefault(x => Check.Number(x["n"]) == next) is { } part)
                {
                    // The last part, where the recording ended before it was asked to: not whole.
                    var last = state == "done" && !done.Any(x => Check.Number(x["n"]) > next);
                    more = !last;
                    return (Check.Number(part["frames"]) / rate, !(last && (string?)st["reason"] != "done"));
                }
                if (state == "done") throw new InvalidOperationException("the device's recording ended early: " + ((string?)st["reason"] ?? "no reason given"));
            }
            else if (state == "done") return (seconds, true);
            if (state == "failed") throw new InvalidOperationException("the device's recording failed: " + ((string?)st["reason"] ?? "no reason given"));
            if (state == "armed" && DateTime.UtcNow - armedSince > TimeSpan.FromSeconds(30)) throw new TimeoutException("the device never started playing the track");
            if (state is "idle") throw new InvalidOperationException("the device stopped recording");
            if (state == "recording") run.Live("Recording what the DAC is fed ({0} s)", parts ? seconds : before + seconds);
        }
    }

    public async Task<JsonObject?> Take(string wav, CancellationToken ct)
    {
        var at = parts ? $"{device}/capture/{next}" : device + "/capture";
        await Check.Fetch(at + ".wav", wav, ct);
        JsonObject? said;
        try { said = (JsonNode.Parse(await Http.GetStringAsync(at + ".wav.json", ct)) as JsonObject)?["capture"] as JsonObject; }
        catch (Exception e) when (e is HttpRequestException or System.Text.Json.JsonException) { said = null; /* a recording with no sidecar: PCM */ }
        if (parts)
        {
            // Fetched: the device lets the part go, so a long track never fills its storage.
            try { using var _ = await Http.DeleteAsync(at, ct); } catch (HttpRequestException) { /* it goes when the next recording starts */ }
            next++;
        }
        return said;
    }

    public async Task Stop(bool failed)
    {
        // In parts, a check that ends before the recording does (the track skipped) stops it, so the next can start.
        if (!failed && !parts) return;
        try { await Http.DeleteAsync(device + "/capture", CancellationToken.None); } catch (HttpRequestException) { /* gone */ }
    }
}
