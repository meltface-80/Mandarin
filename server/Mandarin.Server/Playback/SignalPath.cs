// SignalPath.cs — what a track goes through on its way to the room, every step of it (bug list item 247).
//
// Now playing said it in one line ("WAV 24/705.6 ↑×16 · standard (whole track being made) · DSD256 being made"),
// which said everything and showed little. This says it twice: three lines for Now playing, centred, what goes out,
// how it was made and what is being made for next time; and the steps from the file to the device for its Signal path
// sheet, as Roon shows its own: the source, the ReplayGain, DSD's low-pass, the DSP, the upsampling and its filter, the
// modulator, the output, the device's own word on what it plays, and what is still to be made. Each step is what was
// done to the stream the device is reading now: the plan it was sent by (SentInfo), never the plan the settings would
// make next. A step is lossless (nothing changed), enhanced (changed on purpose), lossy, or pending (not yet so).
// Every step is a fact with its source (item 287): what the file is, what Mandarin did and sent, and what the device
// reports feeding its DAC, in its own words and named as its. Nothing is inferred: "bit-perfect" is never said here.
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
            // A room or headphone correction first (items 252, 258): the response this track ran through, and whether it was made at its rate.
            if (Convolution.For(Renderers.Players.TargetFor(z.DeviceId ?? z.ZoneId)?["dsp"], t.SampleRate ?? 0) is { } conv)
            {
                var made = Jv.Num(conv["rate"]);
                var at = made == (t.SampleRate ?? 0) ? $"made at {Khz(made)} kHz" : $"made at {Khz(made)} kHz, resampled to {Khz(t.SampleRate ?? 0)} kHz";
                steps.Add(Step("convolution", "Room correction", $"{Jv.Str(conv["name"])}, {at}", "enhanced"));
            }
            // At the track's own rate, after the headroom and before any upsampling (item 263); a DSD file's at the rate it goes at.
            var own = t.SampleRate is { } sr and > 0 and <= 768000 ? $", at {Khz(sr)} kHz, before anything is upsampled" : "";
            steps.Add(Step("dsp", "DSP", $"The device’s equaliser, in 64-bit float{own}", "enhanced"));
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
            // Made DSD from PCM (items 242, 243, 259): upsampled to 705.6 kHz (768 kHz in 48 kHz's family: item 261), then the modulator, as it plays.
            var family = s.DsdBase == 48000 ? 48000 : 44100;
            var from = Upsample.DsdPlan.FromRate(t.SampleRate ?? 0, family);
            var top = Upsample.DsdChain.InRateFor(Upsample.DsdPlan.DsdRate((int)s.Dsd, family));
            if (from != (t.SampleRate ?? 0)) steps.Add(Step("resample", "To 44.1 kHz’s family", $"{Khz(t.SampleRate ?? 0)} → {Khz(from)} kHz, by SoX at its finest", "enhanced"));
            steps.Add(Step("upsample", "Upsampling", $"×{N(top / Math.Max(1, from))} to {Khz(top)} kHz · {Upsample.Shape.Name(s.Shape).ToLowerInvariant()}", "enhanced"));
            steps.Add(Step("modulator", "DSD modulator", $"{Upsample.DsdOut.Line(s.Mod)}; doubled to DSD{N(s.Dsd)} ({Mhz(s.Dsd, family)} MHz)", "enhanced"));
            steps.Add(Step("output", "Output", $"DSF, DSD{N(s.Dsd)}, made as it plays, to {z.DisplayName}", "enhanced"));
            output = $"DSD{N(s.Dsd)} · {Mhz(s.Dsd, family)} MHz";
            how = $"From PCM · {Upsample.Shape.Words(s.Shape)} ×{N(top / Math.Max(1, from))} · {Upsample.DsdOut.Words(s.Mod)}";
        }
        else
        {
            var words = s.Transcode ? $"{(s.Mime == "audio/wav" ? "WAV" : "FLAC")} {N(s.Bits)}/{Khz(s.Rate)} kHz"
                : $"{Library.FormatName(t.Container, false) ?? (t.Codec ?? "").ToUpperInvariant()} {N(s.Bits)}/{Khz(s.Rate)} kHz";
            if (s.Upsampled != 0)
            {
                var filter = Upsample.Shape.Name(s.Shape);
                steps.Add(Step("upsample", "Upsampling", $"×{N(s.Upsampled)} to {Khz(s.Rate)} kHz · {filter}", "enhanced"));
                how = filter;
            }
            var exact = !s.Transcode;
            steps.Add(Step("output", "Output", $"{words}{(exact ? ", the file as it is" : "")}, to {z.DisplayName}", exact ? "lossless" : "enhanced"));
            output = words + (s.Upsampled != 0 ? $" ↑×{N(s.Upsampled)}" : "") + (exact ? " · as it is" : "");
        }
        // What the device reports feeding its DAC, as it reports it (item 287).
        if (st.Fed is { } fed) steps.Add(Fed(fed, s));
        if (st.Confirmed) output += " ✓";
        // A stream never made DSD although the device is set to it.
        if (svc != null && Renderers.Players.TargetFor(z.DeviceId ?? z.ZoneId)?["dsd_out"] is double up && up > 0)
        {
            steps.Add(Step("pending", "Not DSD", $"{Service(svc)} plays as PCM: PCM as DSD{N(up)} is made from the library’s own files", "pending"));
            making = $"{Service(svc)} plays as PCM, not DSD";
        }
        if (extras.Count > 0) how = how == null ? string.Join(" · ", extras) : how + " · " + string.Join(" · ", extras);
        return Path([output, how, making], steps);
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

    /*
     * The device's report as a step (item 287): the format the DAC is opened at, how the samples are sent at its depth, what
     * its volume does to them, and who says so. Lossless only where it says the samples go untouched in the format
     * sent; lossy where it says otherwise; pending where it says nothing of the samples.
     */
    private static JsonObject Fed(Fed f, SentInfo s)
    {
        var parts = new List<string>();
        if (f.Kind is "dsd" or "dop") parts.Add($"DSD{N(f.Dsd)} {(f.Kind == "dop" ? "as DoP" : "natively")}");
        else
        {
            var pcm = $"PCM {Khz(f.Rate)} kHz";
            // A DAC opened deeper than the track (16-bit samples to a 32-bit DAC), in plain words (item 289): padded
            // where the device says the samples go untouched, else only that they are sent at its depth.
            if (f.Bits > 0 && s.Bits > 0 && f.Bits > s.Bits)
                pcm += f.Untouched == true ? $", the {N(s.Bits)}-bit samples padded to {N(f.Bits)} bits for the DAC" : $", the {N(s.Bits)}-bit samples sent as {N(f.Bits)}-bit";
            else if (f.Bits > 0) pcm += $", {N(f.Bits)}-bit";
            parts.Add(pcm);
        }
        if (!f.Matches) parts.Add("not the format sent");
        var vol = (f.Volume, f.Untouched) switch
        {
            ("fixed", true) => "fixed volume: the samples untouched",
            ("dac", true) => "the DAC's own volume: the samples untouched",
            (_, true) => "the samples untouched",
            ("software", false) => $"volume {N(f.Level)}% in software: the samples scaled",
            (_, false) => "the samples changed",
            _ => null,
        };
        if (vol != null) parts.Add(vol);
        var quality = !f.Matches || f.Untouched == false ? "lossy" : f.Untouched == true ? "lossless" : "pending";
        var title = f.By == "its own API" ? "The device reports" : "The DAC is fed";
        return Step("fed", title, string.Join(", ", parts) + $" — as {f.By} reports it", quality);
    }

    private static JsonObject Step(string kind, string title, string detail, string quality) =>
        new() { ["kind"] = kind, ["title"] = title, ["detail"] = detail, ["quality"] = quality };

    private static string Service(string id) => id == "qobuz" ? "Qobuz" : id == "tidal" ? "Tidal" : id;
    private static string N(double v) => Tags.Js.Num(v);
    private static string Khz(double hz) => Tags.Js.Num(hz / 1000);
    private static string Mhz(double n, int family = 44100) => Tags.Js.Num(Math.Round(family * n / 1e6, 4));
    private static string Db(double db) => (db > 0 ? "+" : db < 0 ? "−" : "") + Tags.Js.Num(Math.Abs(db)) + " dB";
}
