// Check.cs — the bit-perfect check, end to end (bug list item 275): what reached the DAC compared with what the
// server sent it, frame by frame, for a whole track, on request.
//
// The track is played again from its start, and what feeds the DAC records what it feeds it (Recorder.cs): a Mandarin
// Bridge at its /capture (the very words the USB transfers carry, up to two minutes at a time, so a longer track is
// recorded in turn; a DAC on this server is a Mandarin Bridge's, item 324). Then what was sent is fetched from this
// server as the device fetched it (the cache's file, the file itself, a DSF made as it played) and each recording is
// found in it and compared (Compare.cs). The report says the verdict, how much of the track was compared, and where
// anything differed.
using System.Text.Json.Nodes;

namespace Mandarin.Server.BitPerfect;

internal static class Check
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    /* The most one recording of the device's holds (Mandarin Bridge's limit), in seconds. */
    public const int Most = 120;

    /* What is checked: the track's address on this server, its title, its length, and what was sent of it. */
    public sealed record Track(string Uri, string Title, double Seconds, double Rate, double Bits, double Dsd, double DsdBase);

    /* What the check is told of the room: the track played again from its start, and whether it is still on it. */
    public sealed record Room(Func<Task> Restart, Func<bool> StillOn, string Name);

    /* The check, as far as it has got: its state, what it says, and once done, its report. */
    public sealed class Run
    {
        public volatile string State = "starting";
        public JsonObject? Report;
        public readonly CancellationTokenSource Stop = new();
        public double Recorded;
        // The seconds recorded so far, the part under way among them: what a clock shows while it records (item 292).
        public double Recording;
        // Told whenever it says something new: the room's state bumped, so Now playing shows it.
        public Action? Changed;
        private string said = "Starting";
        public string Said { get => said; set { said = value; Changed?.Invoke(); } }

        /* [seconds] recorded so far, said as [words] (its {0} the seconds, whole). */
        public void Live(string words, double seconds)
        {
            Recording = seconds;
            Said = string.Format(System.Globalization.CultureInfo.InvariantCulture, words, Math.Round(seconds));
        }
    }

    /* [track] in [room], recorded by [recorder] (a Mandarin Bridge renderer's, or this server's USB bus), into [dir]. */
    public static async Task Go(Run run, Track track, Room room, IRecorder recorder, string dir)
    {
        var ct = run.Stop.Token;
        var failed = true;
        try
        {
            var parts = await Recorded(run, track.Seconds, room, recorder, dir, ct);
            run.State = "comparing";
            run.Said = "Comparing what the DAC was fed with what was sent";
            var sent = Path.Combine(dir, "sent");
            await Fetch(track.Uri, sent, ct);
            run.Report = Reported(track, room.Name, Sent(sent, track, dir), parts);
            failed = false;
            // The recordings and what was sent go once compared (a long track's are large); the report is kept.
            foreach (var f in Directory.GetFiles(dir)) File.Delete(f);
            run.State = "done";
            run.Said = (string?)run.Report["says"] ?? "Done";
        }
        // A recording or a stream that can't be read, whatever the fault: said, never a check left "comparing" (item 286).
        catch (Exception e) when (e is HttpRequestException or IOException or OperationCanceledException or InvalidOperationException or TimeoutException or UnauthorizedAccessException
            or ArgumentException or IndexOutOfRangeException or OverflowException or FormatException or System.Text.Json.JsonException)
        {
            run.State = "failed";
            run.Said = ct.IsCancellationRequested ? "Stopped" : "The check couldn't finish: " + e.Message;
        }
        finally { if (failed) await recorder.Stop(true); }
    }

    /*
     * The track [seconds] long, played in [room] from its start, recorded whole by [recorder] into [dir] (emptied
     * first): its recordings, one where they were parts that follow on (Parts.cs). The recorder is stopped once they
     * are all in; where this throws, the caller stops it as failed. SQ-tool's recording of a zone (SqToolRecord.cs)
     * is this, handed to SQ-tool.
     */
    public static async Task<List<(string Wav, JsonObject? Said)>> Recorded(Run run, double seconds, Room room, IRecorder recorder, string dir, CancellationToken ct)
    {
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        Directory.CreateDirectory(dir);
        var parts = new List<(string Wav, JsonObject? Said)>();
        run.Said = "Asking the device to record";
        await recorder.Ask(Math.Min(recorder.Most, (int)Math.Ceiling(seconds) + 2), ct);
        run.Said = "Playing the track from its start";
        await room.Restart();
        while (true)
        {
            run.State = "recording";
            run.Said = $"Recording what the DAC is fed ({Math.Round(run.Recorded)} s of {Math.Round(seconds)} s)";
            var (took, whole) = await recorder.Wait(run, run.Recorded, ct);
            var wav = Path.Combine(dir, $"part{parts.Count + 1}.wav");
            parts.Add((wav, await recorder.Take(wav, ct)));
            run.Recorded += took;
            if (!room.StillOn() || !whole) break;
            // In parts, every one of them; else, the next recording asked for until the track is all recorded.
            if (recorder.More) continue;
            if (run.Recorded + 1 >= seconds) break;
            await recorder.Ask(Math.Min(recorder.Most, (int)Math.Ceiling(seconds - run.Recorded) + 2), ct);
        }
        await recorder.Stop(false);
        // A recording in parts that follow on: the one recording of the track they are (Parts.cs).
        if (Parts.Join(parts, Path.Combine(dir, "whole.wav")) is { } joined) parts = [joined];
        return parts;
    }

    /*
     * `mandarin-server bitperfect`: a line of JSON on standard input, { sent: file, rate, bits?, dsd?, dsd_base?, seconds,
     * title?, parts: [{ wav, said? }] }, compared as a check compares them; the report is a line of JSON on standard
     * output.
     */
    public static int Command()
    {
        var job = JsonNode.Parse(Console.In.ReadLine() ?? "{}") as JsonObject ?? [];
        var track = new Track("", (string?)job["title"] ?? "", Number(job["seconds"]), Number(job["rate"]), Number(job["bits"]), Number(job["dsd"]),
            job["dsd_base"] is JsonValue ? Number(job["dsd_base"]) : 44100);
        var dir = Directory.CreateTempSubdirectory("mandarin-bitperfect-").FullName;
        try
        {
            var parts = (job["parts"] as JsonArray ?? []).OfType<JsonObject>()
                .Select(x => ((string)x["wav"]!, x["said"] as JsonObject)).ToList();
            Console.WriteLine(Reported(track, "", Sent((string)job["sent"]!, track, dir), parts).ToJsonString());
            return 0;
        }
        finally { Directory.Delete(dir, true); }
    }

    public static double Number(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;

    /* [url] fetched to [path]. */
    public static async Task Fetch(string url, string path, CancellationToken ct)
    {
        using var r = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        r.EnsureSuccessStatusCode();
        await using var o = File.Create(path);
        await (await r.Content.ReadAsStreamAsync(ct)).CopyToAsync(o, ct);
    }

    // What was sent, as frames: a DSF read as it is, PCM decoded by ffmpeg to 32-bit words at its own rate.
    private static Frames Sent(string path, Track track, string dir)
    {
        using (var f = File.OpenRead(path))
        {
            var magic = new byte[4];
            if (f.Read(magic) == 4 && magic.AsSpan().SequenceEqual("DSD "u8)) return new DsfFrames(path, track.Dsd * track.DsdBase);
        }
        var raw = Path.Combine(dir, "sent.s32");
        var psi = new System.Diagnostics.ProcessStartInfo(Transcoder.Bin) { UseShellExecute = false, RedirectStandardError = true };
        foreach (var a in new[] { "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", path, "-map", "0:a:0", "-f", "s32le", "-c:a", "pcm_s32le", raw }) psi.ArgumentList.Add(a);
        using var p = System.Diagnostics.Process.Start(psi)!;
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidOperationException("what was sent couldn't be decoded: " + err.Trim());
        return new PcmFrames(raw, 0, 4, track.Rate);
    }

    private static readonly string[] Worst = ["bit-perfect", "dropouts", "altered", "not-bit-perfect", "not-found", "resampled", "unread"];

    // The report: each recording compared with what was sent, and the verdict of them all.
    private static JsonObject Reported(Track track, string room, Frames sent, List<(string Wav, JsonObject? Said)> parts)
    {
        using var _ = sent;
        var list = new JsonArray();
        var verdict = "bit-perfect";
        double compared = 0;
        double? first = null, level = null;
        var drops = new JsonArray();
        JsonObject? fed = null;
        foreach (var (wav, said) in parts)
        {
            fed ??= said;
            var (got, why) = Recording.Open(wav, said);
            Compare.Result r;
            using (got) r = got == null ? Compare.Result.NotFound() with { Verdict = "unread" } : Compare.Of(sent, got);
            if (Array.IndexOf(Worst, r.Verdict) > Array.IndexOf(Worst, verdict)) verdict = r.Verdict;
            compared += r.Compared / sent.Rate;
            first ??= r.FirstDifference;
            level ??= r.LevelDb;
            foreach (var d in r.Dropouts) drops.Add(new JsonObject { ["at"] = Math.Round(d.At, 3), ["kind"] = d.Kind });
            list.Add(new JsonObject
            {
                ["verdict"] = r.Verdict, ["from"] = Math.Round(r.From, 3), ["to"] = Math.Round(r.To, 3), ["compared"] = r.Compared,
                ["differing"] = r.Differing, ["first_difference"] = r.FirstDifference, ["level_db"] = r.LevelDb, ["why"] = why,
                ["interruptions"] = said?["interruptions"]?.DeepClone(), ["usb"] = said?["usb"]?.DeepClone(),
            });
        }
        var coverage = track.Seconds > 0 ? Math.Min(1, compared / track.Seconds) : 0;
        var unrecorded = Unrecorded(track.Seconds, list);
        return new JsonObject
        {
            ["verdict"] = verdict, ["says"] = Says(verdict, coverage, first, level, drops.Count) + Missing(coverage, unrecorded),
            ["unrecorded"] = new JsonArray([.. unrecorded.Select(g => (JsonNode)new JsonObject { ["from"] = Math.Round(g.From, 3), ["to"] = Math.Round(g.To, 3) })]),
            ["track"] = new JsonObject { ["title"] = track.Title, ["uri"] = track.Uri, ["seconds"] = Math.Round(track.Seconds, 3) },
            ["sent"] = new JsonObject { ["rate"] = track.Rate, ["bits"] = track.Bits, ["dsd"] = track.Dsd },
            ["fed"] = fed == null ? null : new JsonObject
            {
                ["kind"] = fed["kind"]?.DeepClone(), ["rate"] = fed["rate"]?.DeepClone(), ["container_bits"] = fed["container_bits"]?.DeepClone(),
                ["valid_bits"] = fed["valid_bits"]?.DeepClone(), ["device"] = fed["device"]?.DeepClone(),
            },
            ["room"] = room, ["compared_seconds"] = Math.Round(compared, 3), ["coverage"] = Math.Round(coverage, 4),
            ["first_difference"] = first, ["level_db"] = level, ["dropouts"] = drops, ["parts"] = list,
            ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
    }

    /* The parts of a [seconds]-long track no recording covered (item 286): the spans between those compared, longer than half a second. */
    public static List<(double From, double To)> Unrecorded(double seconds, JsonArray parts)
    {
        static bool Compared(JsonNode? n) => n is JsonValue v && (v.TryGetValue<long>(out var l) ? l > 0 : v.TryGetValue<double>(out var d) && d > 0);
        var spans = parts.OfType<JsonObject>().Where(p => Compared(p["compared"])).Select(p => (From: Number(p["from"]), To: Number(p["to"]))).OrderBy(x => x.From).ToList();
        var gaps = new List<(double, double)>();
        double at = 0;
        foreach (var (from, to) in spans)
        {
            if (from - at > 0.5) gaps.Add((at, from));
            at = Math.Max(at, to);
        }
        if (seconds - at > 0.5) gaps.Add((at, seconds));
        return gaps;
    }

    // What wasn't recorded, said after the verdict where the track wasn't recorded whole.
    private static string Missing(double coverage, List<(double From, double To)> gaps)
    {
        if (coverage >= 0.995 || gaps.Count == 0) return "";
        static string T(double s) => $"{(int)(s / 60)}:{(int)(s % 60):00}";
        var named = gaps.Take(3).Select(g => T(g.From) + "–" + T(g.To)).ToList();
        var more = gaps.Count > 3 ? $" and {gaps.Count - 3} more" : "";
        return "; not recorded: " + (named.Count > 1 && more.Length == 0 ? string.Join(", ", named[..^1]) + " and " + named[^1] : string.Join(", ", named) + more);
    }

    // The report in a sentence.
    private static string Says(string verdict, double coverage, double? first, double? level, int drops)
    {
        var how = coverage >= 0.995 ? "every sample of the track" : $"{Math.Round(coverage * 100)}% of the track";
        static string At(double? s) => s is { } v ? $"{(int)(v / 60)}:{(int)(v % 60):00}" : "?";
        return verdict switch
        {
            "bit-perfect" => $"Bit-perfect: {how} reached the DAC exactly as it was sent",
            "dropouts" => $"The samples reached the DAC as sent, but with {drops} dropout(s): the stream had gaps or jumps",
            "altered" => $"Altered: most of the track reached the DAC as sent, but some of it differs (first at {At(first)})",
            "not-bit-perfect" => $"Not bit-perfect: the samples differ throughout{(level is { } l ? $", the level {l.ToString("+0.##;-0.##;0", System.Globalization.CultureInfo.InvariantCulture)} dB" : "")}",
            "resampled" => "Resampled: the DAC was fed another rate than was sent",
            "not-found" => "What the DAC was fed isn't the track that was sent",
            _ => "The device's recording couldn't be read",
        };
    }
}
