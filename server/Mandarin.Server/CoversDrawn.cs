// CoversDrawn.cs — the covers the Node server drew with sharp, drawn here
// (v0.8.34, stage 1f of docs/specs/csharp-migration.md), from
// lib/library/artwork.js, with ffmpeg:
//
//   - an album with no cover of its own: its placeholder (artwork.js
//     placeholder): a colour of its own from its title and artist (the same
//     every time), a note, the title (bold, three lines at most) and the
//     artist, on 600 × 600, drawn at the size asked for;
//   - a picture from elsewhere, carried in its key ("u-" and the address in
//     base64url: a radio station's, a track queued from the Sonos app,
//     Last.fm's): fetched as artwork.js fetches it (http or https only,
//     three redirects at most, 15 MB at most, a 200 or nothing) and drawn as
//     an album's cover is. One that can't be had is answered 404, as there.
//
// Still the Node server's: a picture sharp reads and ffmpeg wouldn't draw the
// same (Covers.cs Look), a speaker asking by its own address (only the Node
// server knows its speakers), and a placeholder where this ffmpeg can't draw
// text (no drawtext).
//
// The text is drawn with fontconfig's "sans-serif", as sharp draws the SVG's,
// so with the same fonts (the image's DejaVu). ffmpeg doesn't take a missing
// character from another font as sharp does, so the note asks for a font that
// has it.
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Covers
{
    // ------------------------------------------------------------ placeholders

    private static readonly Lazy<bool> Text = new(() =>
    {
        var yes = DrawsText();
        // Said once: from ffmpeg 6.1 drawtext needs harfbuzz, which some builds leave out (a static one, Homebrew's).
        if (!yes && Transcoder.FfOk) Front.Log("[art] this ffmpeg can't draw text (no drawtext): albums without a cover are drawn by the Node server");
        return yes;
    });

    private static bool DrawsText()
    {
        if (!Transcoder.FfOk) return false;
        try
        {
            using var p = Process.Start(new ProcessStartInfo(Transcoder.Bin, "-hide_banner -filters") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
            var outText = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(10000)) { try { p.Kill(); } catch (Exception) { /* gone */ } return false; }
            return p.ExitCode == 0 && Regex.IsMatch(outText.Result, @"\sdrawtext\s");
        }
        catch (Exception) { return false; }
    }

    /* A placeholder drawn at this size into `file` (artwork.js placeholder). */
    public static Task<Drawn> DrawPlaceholder(Album al, string file, int size) =>
        Once(file, al.ImageKey, async () =>
        {
            if (!Text.Value) return Drawn.NodeIts;
            var jpg = await Placeholder(al.Title, al.Artist, size);
            if (jpg == null) return Drawn.NodeIts;
            Write(file, jpg);
            return Drawn.Yes;
        });

    /* artwork.js wrap: words onto lines of `max` characters, three lines at most. */
    public static List<string> Wrap(string text, int max)
    {
        var lines = new List<string>();
        var cur = "";
        foreach (var w in Regex.Split(text, @"\s+"))
        {
            if ((cur + " " + w).Trim().Length > max && cur.Length > 0) { lines.Add(cur); cur = w; }
            else cur = (cur + " " + w).Trim();
        }
        if (cur.Length > 0) lines.Add(cur);
        return lines.Take(3).ToList();
    }

    /* CSS's hsl(h, s%, l%) as 0–255 red, green and blue. */
    public static (int R, int G, int B) Hsl(double h, double s, double l)
    {
        double C(double n)
        {
            var k = (n + h / 30) % 12;
            var a = s * Math.Min(l, 1 - l);
            return l - a * Math.Max(-1, Math.Min(Math.Min(k - 3, 9 - k), 1));
        }
        int B8(double v) => (int)Math.Round(v * 255, MidpointRounding.AwayFromZero);
        return (B8(C(0)), B8(C(8)), B8(C(4)));
    }

    /* The placeholder's colour: its title and artist's MD5, the first byte as a hue. */
    public static int Hue(string title, string artist) =>
        (int)Math.Round(MD5.HashData(Encoding.UTF8.GetBytes(title + "|" + artist))[0] / 255.0 * 360, MidpointRounding.AwayFromZero);

    private static async Task<byte[]?> Placeholder(string title, string artist, int size)
    {
        var hue = Hue(title, artist);
        var (r0, g0, b0) = Hsl(hue, 0.38, 0.30);
        var (r1, g1, b1) = Hsl((hue + 40) % 360, 0.45, 0.14);
        var lines = Wrap(title, 16);
        // String(al.artist).slice(0, 34): UTF-16 units, as here.
        var by = artist.Length > 34 ? artist[..34] : artist;
        var dir = Directory.CreateTempSubdirectory("mandarin-ph-");
        try
        {
            string Put(string name, string text) { var f = Path.Combine(dir.FullName, name); File.WriteAllText(f, text, new UTF8Encoding(false)); return f; }
            // Each filter option's ':' and '\' escaped for both of ffmpeg's levels (the graph's, then the filter's).
            static string Esc(string v) => v.Replace(@"\", @"\\\\").Replace("'", @"\\\'").Replace(":", @"\\\:").Replace(",", @"\,").Replace(";", @"\;").Replace("[", @"\[").Replace("]", @"\]");
            string Draw(string file, string pattern, int px, string colour, string x, string baseline) =>
                $"drawtext=textfile={Esc(file)}:expansion=none:font=sans-serif{(pattern.Length > 0 ? ":fontfile=" + Esc(pattern) : "")}:fontsize={px}:fontcolor={colour}:x={x}:y={baseline}-ascent";
            // The SVG's diagonal gradient, corner to corner.
            var f = new List<string>
            {
                $"geq=r='{r0}+({r1}-{r0})*(X+Y)/1198':g='{g0}+({g1}-{g0})*(X+Y)/1198':b='{b0}+({b1}-{b0})*(X+Y)/1198'",
                Draw(Put("note", "♪"), ":charset=266a", 110, "white@0.18", "540-text_w", "140"),
            };
            var top = 470 - (lines.Count - 1) * 58;
            for (int i = 0; i < lines.Count; i++) f.Add(Draw(Put("t" + i, lines[i]), ":style=Bold", 50, "white", "40", (top + i * 58).ToString(System.Globalization.CultureInfo.InvariantCulture)));
            f.Add(Draw(Put("by", by), "", 30, "white@0.75", "40", "540"));
            f.Add($"scale={size}:{size}:flags=lanczos+accurate_rnd+full_chroma_int,format=yuvj420p");
            await Drawing.WaitAsync();
            try
            {
                var (code, jpg, err) = await Run(Transcoder.Bin,
                    ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=black:s=600x600:d=1,format=rgb24", "-vf", string.Join(",", f), "-frames:v", "1", "-q:v", "4", "-f", "mjpeg", "pipe:1"],
                    null, 8 << 20, TimeSpan.FromSeconds(30));
                if (code != 0 || jpg.Length == 0)
                {
                    Front.Log($"[art] a placeholder: ffmpeg couldn't draw it ({(err.Trim().Length > 0 ? err.Trim().Split('\n')[0] : "exit " + code)}); passed to the Node server");
                    return null;
                }
                return jpg;
            }
            finally { Drawing.Release(); }
        }
        finally { try { dir.Delete(true); } catch (IOException) { /* gone */ } }
    }

    // ------------------------------------------------------------ pictures from elsewhere

    private static readonly HttpClient Outside = new(new SocketsHttpHandler
    {
        // As Node's http.get: no proxy of the machine's own, redirects followed here.
        UseProxy = false,
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None,
        ConnectTimeout = TimeSpan.FromSeconds(8),
    }) { Timeout = Timeout.InfiniteTimeSpan };

    /* A "u-" key's address (artwork.js source): null when it isn't one. */
    public static string? ForeignUrl(string key)
    {
        if (!key.StartsWith("u-", StringComparison.Ordinal)) return null;
        // Buffer.from(…, "base64url") reads what it can and leaves the rest.
        var b64 = new string(key[2..].Where(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_').ToArray()).Replace('-', '+').Replace('_', '/');
        if (b64.Length % 4 == 1) b64 = b64[..^1];
        b64 = b64.PadRight(b64.Length + (4 - b64.Length % 4) % 4, '=');
        string url;
        try { url = Encoding.UTF8.GetString(Convert.FromBase64String(b64)); } catch (FormatException) { return null; }
        return Regex.IsMatch(url, "^https?://") ? url : null;
    }

    /* A picture from elsewhere drawn at this size into `file`: NoCover when it can't be had (a 404, as the Node server answers). */
    public static Task<Drawn> DrawForeign(string url, string file, int size) =>
        Once(file, "a picture from elsewhere", async () =>
        {
            if (!ProbeOk) return Drawn.NodeIts;
            byte[] src;
            try { src = await Fetch(url, 0); }
            catch (Exception e) when (e is HttpRequestException or IOException or OperationCanceledException or InvalidDataException or UriFormatException or Identify.LookupError)
            {
                Front.Log($"[art] {url}: {e.Message}");
                return Drawn.NoCover;
            }
            var turn = Look(src);
            if (turn == null) return Drawn.NodeIts;
            var jpg = await Fit(src, turn, size, "4", "a picture from elsewhere");
            if (jpg == null) return Drawn.NodeIts;
            Write(file, jpg);
            return Drawn.Yes;
        });

    /* artwork.js fetchUrl: a 200, three redirects at most, 15 MB at most, 8 s without a byte and it's given up (and no limit beside, as there). */
    private static async Task<byte[]> Fetch(string url, int depth)
    {
        Identify.Lookups.Allowed(url);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        HttpResponseMessage res;
        using (var head = new CancellationTokenSource(TimeSpan.FromSeconds(8)))
            res = await Outside.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, head.Token);
        using var _res = res;
        var code = (int)res.StatusCode;
        if (code is >= 300 and < 400 && res.Headers.Location is { } loc && depth < 3)
            return await Fetch(new Uri(new Uri(url), loc).ToString(), depth + 1);
        if (code != 200) throw new HttpRequestException("HTTP " + code);
        await using var body = await res.Content.ReadAsStreamAsync();
        using var buf = new MemoryStream();
        var chunk = new byte[64 << 10];
        while (true)
        {
            using var idle = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var n = await body.ReadAsync(chunk, idle.Token);
            if (n == 0) break;
            if (buf.Length + n > 15L * 1024 * 1024) throw new InvalidDataException("too large");
            buf.Write(chunk, 0, n);
        }
        return buf.ToArray();
    }
}
