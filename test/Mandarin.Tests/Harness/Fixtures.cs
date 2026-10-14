using System.Buffers.Binary;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// A small music library made on the spot with ffmpeg (test/fixtures.js, in C#), so the tests use real
/// files in every format the server has to decide about.
/// </summary>
public static partial class Fixtures
{
    /// <summary>The ffmpeg the fixtures are made with: FFMPEG_PATH, or ffmpeg on the PATH.</summary>
    public static readonly string Ffmpeg = Environment.GetEnvironmentVariable("FFMPEG_PATH") is { Length: > 0 } f ? f : "ffmpeg";

    private static readonly Lazy<bool> haveFfmpeg = new(() => Run(["-version"]).Code == 0);
    private static readonly Lazy<bool> haveDrawtext = new(() => { var r = Run(["-hide_banner", "-filters"]); return r.Code == 0 && DrawtextRe().IsMatch(r.Out); });
    private static readonly Lazy<bool> haveSoxr = new(() => Run(["-version"]).Out.Contains("--enable-libsoxr", StringComparison.Ordinal));

    /// <summary>Whether ffmpeg runs here.</summary>
    public static bool HaveFfmpeg => haveFfmpeg.Value;

    /// <summary>Whether this ffmpeg draws text (drawtext: from 6.1 it needs harfbuzz, which some builds leave out).</summary>
    public static bool HaveDrawtext => haveDrawtext.Value;

    /// <summary>Whether this ffmpeg has libsoxr, which decides the resampler a conversion asks for.</summary>
    public static bool HaveSoxr => haveSoxr.Value;

    /// <summary>A library's folders: its root, the music in it, the data folder for the server.</summary>
    public sealed record Library(string Root, string Music, string Data);

    /// <summary>One audio file: a sine tone of the given length, rate and sample format, with tags.</summary>
    public static void Gen(string output, double seconds = 3, int freq = 440, int rate = 44100, string? fmt = "s16", string[]? codecArgs = null, IDictionary<string, object>? tags = null)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
            "-i", FormattableString.Invariant($"sine=frequency={freq}:duration={seconds}:sample_rate={rate}"), "-ac", "2", "-ar", rate.ToString(System.Globalization.CultureInfo.InvariantCulture) };
        if (fmt != null) args.AddRange(["-sample_fmt", fmt]);
        args.AddRange(codecArgs ?? []);
        foreach (var (k, v) in tags ?? new Dictionary<string, object>()) args.AddRange(["-metadata", k + "=" + Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)]);
        args.Add(output);
        var r = Run(args);
        if (r.Code != 0) throw new InvalidOperationException("ffmpeg: " + r.Err);
    }

    /// <summary>
    /// The fixture library: Album One (Artist A, three FLAC tracks, 1997, Rock, Parlophone, a cover),
    /// Hi Res (Artist B, two 24/96 FLAC tracks, 2020, Jazz) and Best Of (two MP3 discs in CD1 and CD2).
    /// </summary>
    public static Library MakeLibrary()
    {
        var root = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        var music = Path.Combine(root, "music");
        for (int i = 1; i <= 3; i++)
            Gen(Path.Combine(music, "Artist A", "Album One", $"0{i} Song {i}.flac"), freq: 200 * i,
                tags: new Dictionary<string, object> { ["title"] = $"Song {i}", ["artist"] = "Artist A", ["album"] = "Album One", ["track"] = i, ["date"] = "1997", ["genre"] = "Rock", ["label"] = "Parlophone" });
        for (int i = 1; i <= 2; i++)
            Gen(Path.Combine(music, "Artist B", "Hi Res", $"0{i} Hi {i}.flac"), rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], seconds: 4,
                tags: new Dictionary<string, object> { ["title"] = $"Hi {i}", ["artist"] = "Artist B", ["album"] = "Hi Res", ["track"] = i, ["date"] = "2020", ["genre"] = "Jazz", ["label"] = "Blue Note Records (UK)" });
        Gen(Path.Combine(music, "Comp", "CD1", "01.mp3"), fmt: null, codecArgs: ["-b:a", "192k"], tags: new Dictionary<string, object> { ["title"] = "C1", ["artist"] = "X", ["album"] = "Best Of", ["track"] = 1 });
        Gen(Path.Combine(music, "Comp", "CD2", "01.mp3"), fmt: null, codecArgs: ["-b:a", "192k"], tags: new Dictionary<string, object> { ["title"] = "C2", ["artist"] = "Y", ["album"] = "Best Of", ["track"] = 1, ["disc"] = 2 });
        Run(["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=500x500", "-frames:v", "1", Path.Combine(music, "Artist A", "Album One", "cover.jpg")]);
        return new Library(root, music, Path.Combine(root, "data"));
    }

    /// <summary>A DSD64 file (DSF) of DSD silence: the header chunks as the format lays them out, then whole 4096-byte blocks per channel.</summary>
    public static void WriteDsf(string file, double seconds = 1, int rate = 2822400)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        const int block = 4096;
        long samples = (long)Math.Round(seconds * rate);
        long perCh = (long)Math.Ceiling(samples / 8.0 / block) * block;
        var data = new byte[perCh * 2];
        Array.Fill(data, (byte)0x69);
        var dsd = new byte[28]; var fmt = new byte[52]; var dh = new byte[12];
        Encoding.ASCII.GetBytes("DSD ").CopyTo(dsd, 0);
        BinaryPrimitives.WriteUInt64LittleEndian(dsd.AsSpan(4), 28);
        BinaryPrimitives.WriteUInt64LittleEndian(dsd.AsSpan(12), (ulong)(28 + 52 + 12 + data.Length));
        Encoding.ASCII.GetBytes("fmt ").CopyTo(fmt, 0);
        BinaryPrimitives.WriteUInt64LittleEndian(fmt.AsSpan(4), 52);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(12), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(16), 0);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(20), 2);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(24), 2);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(28), (uint)rate);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(32), 1);
        BinaryPrimitives.WriteUInt64LittleEndian(fmt.AsSpan(36), (ulong)samples);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(44), block);
        Encoding.ASCII.GetBytes("data").CopyTo(dh, 0);
        BinaryPrimitives.WriteUInt64LittleEndian(dh.AsSpan(4), (ulong)(12 + data.Length));
        using var f = File.Create(file);
        f.Write(dsd); f.Write(fmt); f.Write(dh); f.Write(data);
    }

    /// <summary>A FLAC's stream info, read straight from its STREAMINFO block: sample rate, channels, bits per sample; null when it isn't FLAC.</summary>
    public static (int Rate, int Channels, int Bits)? Probe(byte[] buf)
    {
        if (buf.Length < 42 || Encoding.ASCII.GetString(buf, 0, 4) != "fLaC") return null;
        var si = buf.AsSpan(8, 34);
        int rate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
        int channels = ((si[12] >> 1) & 0x7) + 1;
        int bits = (((si[12] & 1) << 4) | (si[13] >> 4)) + 1;
        return (rate, channels, bits);
    }

    /// <summary>ffmpeg run with <paramref name="args"/>: its exit code and what it printed.</summary>
    public static (int Code, string Out, string Err) Run(IEnumerable<string> args)
    {
        try
        {
            var psi = new ProcessStartInfo(Ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            var o = p.StandardOutput.ReadToEndAsync();
            var e = p.StandardError.ReadToEndAsync();
            p.WaitForExit();
            return (p.ExitCode, o.Result, e.Result);
        }
        catch (System.ComponentModel.Win32Exception ex) { return (-1, "", ex.Message); }
    }

    [GeneratedRegex(@"\sdrawtext\s")]
    private static partial Regex DrawtextRe();
}
