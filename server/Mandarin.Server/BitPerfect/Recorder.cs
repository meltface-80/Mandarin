// Recorder.cs — what records what a DAC is fed, for the bit-perfect check (bug list item 275): a Mandarin USB
// renderer at its /capture (DeviceRecorder, here), or this server's own USB bus where the DAC is plugged into the
// server (UsbRecorder.cs, through the kernel's usbmon). Either is asked to record, waited for, and its recording taken
// as a WAV with its sidecar's "capture" (Recording.cs reads them).
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
}

/* A Mandarin USB renderer's /capture (github.com/meltface-80/Android-USB-Driver), at its base address [device]. */
internal sealed class DeviceRecorder(string device) : IRecorder
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    public int Most => Check.Most;

    public async Task Ask(int seconds, CancellationToken ct)
    {
        using var r = await Http.PostAsJsonAsync(device + "/capture", new { seconds }, ct);
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException($"the device wouldn't record (HTTP {(int)r.StatusCode}: {(await r.Content.ReadAsStringAsync(ct)).Trim()})");
    }

    public async Task<(double Seconds, bool Whole)> Wait(Check.Run run, double before, CancellationToken ct)
    {
        var armedSince = DateTime.UtcNow;
        while (true)
        {
            await Task.Delay(1000, ct);
            var st = JsonNode.Parse(await Http.GetStringAsync(device + "/capture", ct)) as JsonObject ?? [];
            var state = (string?)st["state"];
            var seconds = Check.Number(st["frames"]) / Math.Max(1, Check.Number(st["rate"]));
            if (state == "done") return (seconds, true);
            if (state == "failed") throw new InvalidOperationException("the device's recording failed: " + ((string?)st["reason"] ?? "no reason given"));
            if (state == "armed" && DateTime.UtcNow - armedSince > TimeSpan.FromSeconds(30)) throw new TimeoutException("the device never started playing the track");
            if (state is "idle") throw new InvalidOperationException("the device stopped recording");
            if (state == "recording") run.Said = $"Recording what the DAC is fed ({Math.Round(before + seconds)} s)";
        }
    }

    public async Task<JsonObject?> Take(string wav, CancellationToken ct)
    {
        await Check.Fetch(device + "/capture.wav", wav, ct);
        try { return (JsonNode.Parse(await Http.GetStringAsync(device + "/capture.wav.json", ct)) as JsonObject)?["capture"] as JsonObject; }
        catch (Exception e) when (e is HttpRequestException or System.Text.Json.JsonException) { return null; /* a recording with no sidecar: PCM */ }
    }

    public async Task Stop(bool failed)
    {
        if (!failed) return;
        try { await Http.DeleteAsync(device + "/capture", CancellationToken.None); } catch (HttpRequestException) { /* gone */ }
    }
}
