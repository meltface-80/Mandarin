// SignalPath.cs — what a track goes through on its way to the room, every step of it (bug list item 247).
//
// Now playing said it in one line ("WAV 24/705.6 ↑×16 · standard (whole track being made) · DSD256 being made"),
// which said everything and showed little. This says it twice: three lines for Now playing, centred, what goes out,
// how it was made and what is being made for next time; and the steps from the file to the device for its Signal path
// sheet, as Roon shows its own: the source, the ReplayGain, DSD's low-pass, the DSP, the upsampling and its filter, the
// modulator, the output, the device's own word on what it plays, and what is still to be made. Each step is what was
// done to the stream the device is reading now: the plan it was sent by (SentInfo), never the plan the settings would
// make next. A step is lossless (nothing changed), enhanced (changed on purpose), lossy, or pending (not yet so).
using System.Text.Json.Nodes;

namespace Mandarin.Server.Playback;

internal static class SignalPath
{
    /*
     * The lines and the steps for zone [z] in state [st], playing [t]; null where there is nothing more to say than the
     * badge (a phone, a Sonos room: the badge is all that is known of the way there), the page and the app then drawing it.
     */
    public static JsonObject? Of(ZoneInfo z, ZoneState st, PlayTrack? t) =>
        z.IsUpnp && st.Sent != null && t != null ? Renderer(z, st, st.Sent, t) : null;

    private static JsonObject Renderer(ZoneInfo z, ZoneState st, SentInfo s, PlayTrack t)
    {
        var steps = new JsonArray { Source(t) };
        string? how = null, making = null;
        var extras = new List<string>();
        var svc = StreamPlans.ServiceOf(t.Path);
        if (s.Gain != 0)
        {
            steps.Add(Step("gain", "Volume levelling", $"ReplayGain {Db(s.Gain)}", "enhanced"));
            extras.Add($"ReplayGain {Db(s.Gain)}");
        }
        if (s.Lowpass != 0)
        {
            var cut = s.Lowpass == 66150 ? 30 : 50;
            steps.Add(Step("lowpass", "DSD’s noise taken off", $"Low-passed at {cut} kHz: through {Khz(s.Lowpass)} kHz and back, by SoX", "enhanced"));
            how = $"Low-passed at {cut} kHz";
        }
        if (s.Dsp)
        {
            steps.Add(Step("dsp", "DSP", "The device’s equaliser, in 64-bit float", "enhanced"));
            extras.Add("DSP");
        }
        string output;
        if (s.Dsd != 0 && !s.Transcode)
        {
            // DSD as it is: the file itself.
            output = $"DSD{N(s.Dsd)}";
            steps.Add(Step("output", "Output", $"DSD{N(s.Dsd)} ({Mhz(s.Dsd)} MHz), the file as it is, to {z.DisplayName}", "lossless"));
            how = "As recorded";
        }
        else if (s.Dsd != 0)
        {
            // Made DSD from PCM (items 242, 243): upsampled whole to 705.6 kHz, then the modulator.
            var from = Upsample.DsdPlan.FromRate(t.SampleRate ?? 0);
            if (from != (t.SampleRate ?? 0)) steps.Add(Step("resample", "To 44.1 kHz’s family", $"{Khz(t.SampleRate ?? 0)} → {Khz(from)} kHz, by SoX at its finest", "enhanced"));
            steps.Add(Step("upsample", "Upsampling", $"×{N(Upsample.DsdChain.InRate / Math.Max(1, from))} to 705.6 kHz · {Upsample.WholeShape.Name(s.Shape).ToLowerInvariant()}, one transform as long as the track", "enhanced"));
            steps.Add(Step("modulator", "DSD modulator", $"Seventh order, its noise shaped out of the audio band; doubled to DSD{N(s.Dsd)} ({Mhz(s.Dsd)} MHz)", "enhanced"));
            steps.Add(Step("output", "Output", $"DSF, DSD{N(s.Dsd)}, to {z.DisplayName}", "enhanced"));
            output = $"DSD{N(s.Dsd)} · {Mhz(s.Dsd)} MHz";
            how = $"From PCM · {Upsample.WholeShape.Making(s.Shape)} ×{N(Upsample.DsdChain.InRate / Math.Max(1, from))} · 7th-order modulator";
        }
        else
        {
            var words = s.Transcode ? $"{(s.Mime == "audio/wav" ? "WAV" : "FLAC")} {N(s.Bits)}/{Khz(s.Rate)} kHz"
                : $"{Library.FormatName(t.Container, false) ?? (t.Codec ?? "").ToUpperInvariant()} {N(s.Bits)}/{Khz(s.Rate)} kHz";
            if (s.Upsampled != 0)
            {
                var (filter, state) = Filter(s, t);
                steps.Add(Step("upsample", "Upsampling", $"×{N(s.Upsampled)} to {Khz(s.Rate)} kHz · {filter}{(state != null ? $" ({state})" : "")}", "enhanced"));
                how = state != null ? $"{filter} · {state}" : filter;
            }
            var exact = !s.Transcode;
            steps.Add(Step("output", "Output", $"{words}{(exact ? ", the file as it is" : "")}, to {z.DisplayName}", exact ? "lossless" : "enhanced"));
            output = words + (s.Upsampled != 0 ? $" ↑×{N(s.Upsampled)}" : "") + (exact ? " · bit-perfect" : "");
        }
        if (st.Verified == "yes")
        {
            steps.Add(Step("verified", "Confirmed by the device", "It reports playing what it was sent", "lossless"));
            output += " ✓";
        }
        // Still to be made: the DSF this track was sent as PCM for; a stream never made DSD although the device is set to it.
        if (s.DsdMaking != 0)
        {
            var state = Upsample.WholeJobs.State(t.Id);
            var words = state is "queued" or "making" ? "being made" : state == "failed" ? "failed: see the log" : "next play";
            steps.Add(Step("pending", "Being made", $"DSD{s.DsdMaking} for this track’s next play: {(state == "queued" ? "waiting" : words)}", "pending"));
            making = $"DSD{s.DsdMaking} {words}";
        }
        else if (svc != null && Renderers.Players.TargetFor(z.DeviceId ?? z.ZoneId)?["dsd_out"] is double up && up > 0)
        {
            steps.Add(Step("pending", "Not DSD", $"{Service(svc)} plays as PCM: PCM as DSD{N(up)} is made from the library’s own files", "pending"));
            making = $"{Service(svc)} plays as PCM, not DSD";
        }
        if (extras.Count > 0) how = how == null ? string.Join(" · ", extras) : how + " · " + string.Join(" · ", extras);
        return Path([output, how, making], steps);
    }

    // The upsampling filter, and where the whole track is if it was planned and didn't go (items 237, 239).
    private static (string Filter, string? State) Filter(SentInfo s, PlayTrack t)
    {
        if (!s.Whole) return ("Standard filter", null);
        if (Upsample.WholeServed.Last(t.Id, s.Rate) == true) return (Upsample.WholeShape.Name(s.Shape), null);
        var state = Upsample.WholeJobs.State(t.Id);
        var what = Upsample.WholeShape.Making(s.Shape);   // whole track, minimum phase, gentle filter (item 248)
        return ("Standard filter", state is "queued" or "making" ? $"{what} being made" : state == "failed" ? $"{what} failed: see the log" : $"{what} next play");
    }

    private static JsonObject Source(PlayTrack t)
    {
        var svc = StreamPlans.ServiceOf(t.Path);
        var name = Library.FormatName(t.Container, t.Lossless) ?? (t.Codec ?? "").ToUpperInvariant();
        var rate = t.SampleRate is > 0 ? $"/{Khz(t.SampleRate.Value)} kHz" : "";
        var bits = t.Bits is > 0 ? $" {t.Bits}" : "";
        var chans = t.Channels is > 2 ? $" · {t.Channels} channels" : "";
        return Step("source", svc != null ? $"{Service(svc)} stream" : "File", $"{name}{bits}{rate}{chans}".Trim(), t.Lossless ? "lossless" : "lossy");
    }

    private static JsonObject Path(string?[] lines, JsonArray steps) => new()
    {
        ["lines"] = new JsonArray(lines.Where(l => !string.IsNullOrEmpty(l)).Select(l => (JsonNode)JsonValue.Create(l)!).ToArray()),
        ["steps"] = steps,
    };

    private static JsonObject Step(string kind, string title, string detail, string quality) =>
        new() { ["kind"] = kind, ["title"] = title, ["detail"] = detail, ["quality"] = quality };

    private static string Service(string id) => id == "qobuz" ? "Qobuz" : id == "tidal" ? "Tidal" : id;
    private static string N(double v) => Tags.Js.Num(v);
    private static string Khz(double hz) => Tags.Js.Num(hz / 1000);
    private static string Mhz(double n) => Tags.Js.Num(Math.Round(44100 * n / 1e6, 4));
    private static string Db(double db) => (db > 0 ? "+" : db < 0 ? "−" : "") + Tags.Js.Num(Math.Abs(db)) + " dB";
}
