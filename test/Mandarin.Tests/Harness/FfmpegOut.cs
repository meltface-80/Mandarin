using System.Diagnostics;

namespace Mandarin.Tests;

/// <summary>ffmpeg run for what it writes to its output (a file made in memory), and what it can make.</summary>
public static class FfmpegOut
{
    /// <summary>ffmpeg (the suite's, FFMPEG_PATH or the one on the path) run with <paramref name="args"/>: its exit code, its output as bytes, what it said.</summary>
    public static (int Code, byte[] Out, string Err) Run(IEnumerable<string> args, string? ffmpeg = null)
    {
        var psi = new ProcessStartInfo(ffmpeg ?? Fixtures.Ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var err = p.StandardError.ReadToEndAsync();
        using var ms = new MemoryStream();
        p.StandardOutput.BaseStream.CopyTo(ms);
        p.WaitForExit();
        return (p.ExitCode, ms.ToArray(), err.Result);
    }

    private static readonly Lazy<bool> flac32 = new(() =>
    {
        try
        {
            var (code, b, _) = Run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "0.2",
                "-sample_fmt", "s32", "-bits_per_raw_sample", "32", "-c:a", "flac", "-f", "flac", "-"]);
            if (code != 0 || b.Length <= 42 || System.Text.Encoding.ASCII.GetString(b, 0, 4) != "fLaC") return false;
            var si = b.AsSpan(8, 34);
            return ((((si[12] & 1) << 4) | (si[13] >> 4)) + 1) == 32;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }
    });

    /// <summary>Whether this ffmpeg writes 32-bit FLAC (its STREAMINFO says 32 bits a sample).</summary>
    public static bool HaveFlac32 => flac32.Value;
}
