// TagReader.cs — what the scanner reads from one file (v0.8.13): music-metadata's
// parseFile (the reader chosen by the file's name, or by its first bytes the way
// file-type 21 picks one), then lib/library/scanner.js readTags on what it found.
//
// The result is readTags' own object, key for key, so the two can be compared
// as JSON: until the scanner reads with this, the Node server reads every file
// both ways and reports any difference (lib/library/tagcheck.js).
using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Tags;

internal static partial class TagReader
{
    private static readonly (string Parser, string[] Extensions)[] Loaders =
    [
        ("flac", [".flac"]),
        ("mpeg", [".mp1", ".mp2", ".mp3", ".m2a", ".aac", "aacp"]),
        ("apev2", [".ape"]),
        ("mp4", [".mp4", ".m4a", ".m4b", ".m4pa", "m4v", "m4r", "3gp", ".mov", ".movie", ".qt"]),
        ("matroska", [".mka", ".mkv", ".mk3d", ".mks", "webm"]),
        ("riff", [".wav", "wave", ".bwf"]),
        ("ogg", [".ogg", ".ogv", ".oga", ".ogm", ".ogx", ".opus", ".spx"]),
        ("asf", [".asf", ".wma", ".wmv"]),
        ("aiff", [".aif", "aiff", "aifc"]),
        ("wavpack", [".wv", ".wvp"]),
        ("musepack", [".mpc"]),
        ("dsf", [".dsf"]),
        ("dsdiff", [".dff"])
    ];

    private static readonly (string Parser, string[] Mimes)[] MimeLoaders =
    [
        ("flac", ["audio/flac"]),
        ("mpeg", ["audio/mpeg", "audio/mp3", "audio/aacs", "audio/aacp"]),
        ("apev2", ["audio/ape", "audio/monkeys-audio"]),
        ("mp4", ["audio/mp4", "audio/m4a", "video/m4v", "video/mp4", "video/quicktime"]),
        ("matroska", ["audio/matroska", "video/matroska", "audio/webm", "video/webm"]),
        ("riff", ["audio/vnd.wave", "audio/wav", "audio/wave"]),
        ("ogg", ["audio/ogg", "audio/opus", "audio/speex", "video/ogg"]),
        ("asf", ["audio/ms-wma", "video/ms-wmv", "audio/ms-asf", "video/ms-asf", "application/vnd.ms-asf"]),
        ("aiff", ["audio/aiff", "audio/aif", "audio/aifc", "application/aiff"]),
        ("wavpack", ["audio/wavpack"]),
        ("musepack", ["audio/musepack"]),
        ("dsf", ["audio/dsf"]),
        ("dsdiff", ["audio/dsf", "audio/dsd"])
    ];

    /* ParserFactory.findLoaderForExtension: the full path's last ".", as there. */
    private static string? ByExtension(string path)
    {
        var i = path.LastIndexOf('.');
        var ext = i == -1 ? "" : Js.Lower(path[i..]);
        if (ext.Length == 0) ext = path;
        foreach (var (p, exts) in Loaders) if (exts.Contains(ext)) return p;
        return null;
    }

    private static string? ByMime(string mime)
    {
        var semi = mime.IndexOf(';');
        var type = (semi >= 0 ? mime[..semi] : mime).Trim().ToLowerInvariant();
        var slash = type.IndexOf('/');
        if (slash < 0) return null;
        var sub = type[(slash + 1)..];
        if (sub.StartsWith("x-", StringComparison.Ordinal)) sub = sub[2..];
        var want = type[..slash] + "/" + sub;
        foreach (var (p, mimes) in MimeLoaders) if (mimes.Any(m => m.Contains(want, StringComparison.Ordinal))) return p;
        return null;
    }

    /* music-metadata's parseFile(file, { skipCovers: true, duration: false }). */
    public static Collector ParseFile(string path)
    {
        using var tok = new FileTok(path);
        var loader = ByExtension(path);
        var ape = Ape.ScanAppending(tok);
        if (loader is null)
        {
            var buf = new U8(4100);
            tok.PeekBuffer(buf, null, null, true);
            var mime = Sniff.Mime(buf) ?? throw new JsError("Failed to determine audio format");
            loader = ByMime(mime) ?? throw new JsError($"Guessed MIME-type not supported: {mime}");
        }
        var md = new Collector();
        switch (loader)
        {
            case "flac": new FlacParser(md, tok, ape).Parse(); break;
            case "mpeg": new MpegParser(md, tok, ape).Parse(); break;
            case "dsf": new DsfParser(md, tok, ape).Parse(); break;
            case "mp4": new Mp4Parser(md, tok).Parse(); break;
            case "ogg": new OggParser(md, tok).Parse(); break;
            case "riff": new WaveParser(md, tok).Parse(); break;
            case "aiff": new AiffParser(md, tok).Parse(); break;
            case "dsdiff": new DsdiffParser(md, tok).Parse(); break;
            case "wavpack": new WavPackParser(md, tok).Parse(); break;
            case "apev2": new ApeFileParser(md, tok).Parse(); break;
            case "asf": new AsfParser(md, tok).Parse(); break;
            default: throw new JsError($"The {loader} reader is not part of this port");
        }
        return md;
    }

    // ---- lib/library/scanner.js ------------------------------------------------

    [GeneratedRegex(@"[0-9]{4}", RegexOptions.CultureInvariant)]
    private static partial Regex FourDigits();

    [GeneratedRegex(@"^([0-9]{4})(?:[-/.]?([0-9]{2})(?:[-/.]?([0-9]{2}))?)?(?:[T ][^\n\r\u2028\u2029]*)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex DateShape();

    public static double? YearOf(object? v)
    {
        var m = FourDigits().Match(Js.Str(Js.IsNullish(v) ? "" : v));
        if (!m.Success) return null;
        var y = double.Parse(m.Value, CultureInfo.InvariantCulture);
        return y > 1000 && y < 3000 ? y : null;
    }

    public static string? DateOf(object? v)
    {
        var s = Js.Trim(Js.Str(Js.IsNullish(v) ? "" : v));
        if (YearOf(s) is not double y) return null;
        var ys = Js.Num(y);
        var m = DateShape().Match(s);
        if (!m.Success || double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) != y || !m.Groups[2].Success) return ys;
        var mo = int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        if (mo < 1 || mo > 12) return ys;
        var ym = $"{ys}-{m.Groups[2].Value}";
        if (!m.Groups[3].Success) return ym;
        var d = int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture);
        var days = DateTime.DaysInMonth((int)y, mo);
        return d >= 1 && d <= days ? $"{ym}-{m.Groups[3].Value}" : ym;
    }

    private static (object? Year, object? Date) ReleaseDateOf(JsObj c)
    {
        var year = YearOf(c["originaldate"]) ?? YearOf(c["originalyear"]) ?? YearOf(c["date"]) ?? YearOf(c["year"]);
        if (year is not double y) return (null, null);
        var ys = Js.Num(y);
        var date = ys;
        foreach (var v in new[] { c["originaldate"], c["date"] })
        {
            var d = DateOf(v);
            if (d is not null && d.StartsWith(ys, StringComparison.Ordinal) && d.Length > date.Length) date = d;
        }
        return (y, date);
    }

    private static List<object?> SplitGenres(object? list)
    {
        var outList = new List<object?>();
        if (list is not List<object?> l) return outList;
        foreach (var g in l)
        {
            foreach (var part in Js.Str(g).Split(';', '\0'))
            {
                var t = Js.Trim(part);
                if (t.Length == 0) continue;
                var lower = Js.Lower(t);
                if (!outList.Any(x => Js.Lower((string)x!) == lower)) outList.Add(t);
            }
        }
        return outList;
    }

    /* allTags: every native tag as text, by upper-cased name; pictures and binary left out. */
    public static JsObj AllTags(Collector md)
    {
        var o = new JsObj();
        foreach (var (_, tags) in md.Native)
        {
            foreach (var (id, v) in tags)
            {
                if (Js.IsNullish(v)) continue;
                if (Js.IsObject(v))
                {
                    var data = v is JsObj jo ? jo["data"] : Undef.V;
                    var format = v is JsObj jf ? jf["format"] : Undef.V;
                    if (Js.Truthy(data) || format is "image/jpeg") continue;
                }
                string s;
                if (Js.IsObject(v))
                {
                    var text = v is JsObj jt ? jt["text"] : Undef.V;
                    s = !Js.IsNullish(text) ? Js.Str(text) : Js.Json(v) ?? "";
                }
                else s = Js.Str(v);
                s = Js.Trim(s);
                if (s.Length == 0) continue;
                if (s.Length > 4000) s = s[..4000];
                var k = Js.Upper(id);
                if (o[k] is not List<object?> list) { list = []; o[k] = list; }
                if (!list.Any(x => (string)x! == s) && list.Count < 50) list.Add(s);
            }
        }
        return o;
    }

    private static object? First(object? v) => v is List<object?> l ? (l.Count > 0 ? l[0] : Undef.V) : v;

    private static object? Clean(object? v)
    {
        var s = Js.IsNullish(v) ? "" : Js.Trim(Js.Str(v));
        return s.Length > 0 ? s : null;
    }

    private static object? Digits(object? v)
    {
        if (Clean(v) is not string s) return null;
        var d = new string(s.Where(c => c >= '0' && c <= '9').ToArray());
        return d.Length > 0 ? d : null;
    }

    private static object? Or(params Func<object?>[] parts)
    {
        object? last = null;
        foreach (var p in parts) { last = p(); if (Js.Truthy(last)) return last; }
        return last;
    }

    private static object? Db(object? v)
    {
        if (Js.IsNullish(v)) return null;
        if (v is JsObj o && o["dB"] is double d && double.IsFinite(d)) return Js.Round(d * 100) / 100;
        var s = Js.Str(v);
        var comma = s.IndexOf(',');
        if (comma >= 0) s = s[..comma] + "." + s[(comma + 1)..];
        var n = Js.ParseFloat(s);
        return double.IsFinite(n) ? n : null;
    }

    private static object? PeakOf(object? v)
    {
        if (Js.IsNullish(v)) return null;
        if (v is JsObj o && o["ratio"] is double r && double.IsFinite(r)) return r;
        var n = Js.ParseFloat(v);
        return double.IsFinite(n) ? n : null;
    }

    /* scanner.js readTags, before the folder names fill what the file lacks. */
    public static JsObj ReadTags(string file)
    {
        var md = ParseFile(file);
        var c = md.Common;
        object? F(string k) => md.Fmt(k);
        var tags = AllTags(md);
        object? Tag(string k) => tags[k] is List<object?> l && l.Count > 0 ? l[0] : Undef.V;

        object? labelTag = c["label"] is List<object?> labels && labels.Count > 0 && Js.Truthy(labels[0]) ? labels[0] : null;
        var (year, date) = ReleaseDateOf(c);
        var track = c["track"] as JsObj;
        var disk = c["disk"] as JsObj;
        var artists = c["artists"] as List<object?>;

        var tagged = new JsObj();
        tagged["artist"] = Js.Truthy(c["artist"]) || (artists is not null && artists.Count > 0) || Js.Truthy(c["albumartist"]);
        tagged["album"] = Js.Truthy(c["album"]);
        tagged["title"] = Js.Truthy(c["title"]);
        tagged["track"] = track is not null && Js.Truthy(track["no"]);
        tagged["disc"] = disk is not null && Js.Truthy(disk["no"]);
        tagged["year"] = Js.Truthy(year);

        var r = new JsObj();
        r["tagged"] = tagged;
        r["title"] = Js.Truthy(c["title"]) ? c["title"] : Basename(file);
        r["artist"] = Js.Truthy(c["artist"]) ? c["artist"]
            : artists is not null && Js.Truthy(string.Join(", ", artists.Select(a => Js.IsNullish(a) ? "" : Js.Str(a)))) ? string.Join(", ", artists.Select(a => Js.IsNullish(a) ? "" : Js.Str(a)))
            : "";
        r["album_artist"] = Js.Truthy(c["albumartist"]) ? c["albumartist"] : "";
        r["album"] = Js.Truthy(c["album"]) ? c["album"] : "";
        r["artist_sort"] = Js.Truthy(c["albumartistsort"]) ? c["albumartistsort"] : Js.Truthy(c["artistsort"]) ? c["artistsort"] : "";
        r["compilation"] = Js.Truthy(c["compilation"]);
        r["track_no"] = track is not null && Js.Truthy(track["no"]) ? track["no"] : null;
        r["disc_no"] = disk is not null && Js.Truthy(disk["no"]) ? disk["no"] : null;
        var duration = Js.ToNumber(F("duration"));
        r["duration"] = Js.Truthy(duration) ? duration : 0.0;
        r["codec"] = Js.Truthy(F("codec")) ? F("codec") : null;
        r["container"] = Js.Truthy(F("container")) ? F("container") : null;
        r["sample_rate"] = Js.Truthy(F("sampleRate")) ? F("sampleRate") : null;
        r["bits"] = Js.Truthy(F("bitsPerSample")) ? F("bitsPerSample") : null;
        r["channels"] = Js.Truthy(F("numberOfChannels")) ? F("numberOfChannels") : null;
        r["lossless"] = Js.Truthy(F("lossless")) ? 1.0 : 0.0;
        r["year"] = year;
        r["date"] = date;
        r["label"] = labelTag is not null ? Js.Trim(Js.Str(labelTag)) : null;
        r["genres"] = SplitGenres(c["genre"]);

        object? R128(string k)
        {
            var n = Js.ParseFloat(Tag(k));
            return double.IsFinite(n) ? Js.Round((n / 256 + 5) * 100) / 100 : null;
        }
        r["isrc"] = Clean(Or(() => First(c["isrc"]), () => Tag("ISRC"), () => Tag("TSRC")));
        r["barcode"] = Digits(Or(() => First(c["barcode"]), () => Tag("BARCODE"), () => Tag("UPC"), () => Tag("EAN")));
        r["catno"] = Clean(Or(() => First(c["catalognumber"]), () => Tag("CATALOGNUMBER"), () => Tag("LABELNO"), () => Tag("CATALOG")));
        r["country"] = Clean(Or(() => c["releasecountry"], () => Tag("RELEASECOUNTRY")));
        r["mb_album"] = Clean(c["musicbrainz_albumid"]);
        r["mb_group"] = Clean(c["musicbrainz_releasegroupid"]);
        r["mb_recording"] = Clean(c["musicbrainz_recordingid"]);
        r["rg_track_gain"] = Db(c["replaygain_track_gain"]) ?? R128("R128_TRACK_GAIN");
        r["rg_track_peak"] = PeakOf(c["replaygain_track_peak"]);
        r["rg_album_gain"] = Db(c["replaygain_album_gain"]) ?? R128("R128_ALBUM_GAIN");
        r["rg_album_peak"] = PeakOf(c["replaygain_album_peak"]);
        r["tags"] = tags;
        return r;
    }

    /* path.basename(file, path.extname(file)), as Node's posix path takes them. */
    public static string Basename(string path)
    {
        var ext = Extname(path);
        if (ext.Length > 0 && ext.Length <= path.Length)
        {
            if (ext == path) return "";
            int start = 0, end = -1, extIdx = ext.Length - 1, firstNonSlashEnd = -1;
            var matchedSlash = true;
            for (var i = path.Length - 1; i >= 0; --i)
            {
                var code = path[i];
                if (code == '/')
                {
                    if (!matchedSlash) { start = i + 1; break; }
                }
                else
                {
                    if (firstNonSlashEnd == -1) { matchedSlash = false; firstNonSlashEnd = i + 1; }
                    if (extIdx >= 0)
                    {
                        if (code == ext[extIdx]) { if (--extIdx == -1) end = i; }
                        else { extIdx = -1; end = firstNonSlashEnd; }
                    }
                }
            }
            if (start == end) end = firstNonSlashEnd;
            else if (end == -1) end = path.Length;
            return path[start..end];
        }
        {
            int start = 0, end = -1;
            var matchedSlash = true;
            for (var i = path.Length - 1; i >= 0; --i)
            {
                if (path[i] == '/') { if (!matchedSlash) { start = i + 1; break; } }
                else if (end == -1) { matchedSlash = false; end = i + 1; }
            }
            return end == -1 ? "" : path[start..end];
        }
    }

    private static string Extname(string path)
    {
        int startDot = -1, startPart = 0, end = -1, preDotState = 0;
        var matchedSlash = true;
        for (var i = path.Length - 1; i >= 0; --i)
        {
            var code = path[i];
            if (code == '/')
            {
                if (!matchedSlash) { startPart = i + 1; break; }
                continue;
            }
            if (end == -1) { matchedSlash = false; end = i + 1; }
            if (code == '.')
            {
                if (startDot == -1) startDot = i;
                else if (preDotState != 1) preDotState = 1;
            }
            else if (startDot != -1) preDotState = -1;
        }
        if (startDot == -1 || end == -1 || preDotState == 0 || (preDotState == 1 && startDot == end - 1 && startDot == startPart + 1)) return "";
        return path[startDot..end];
    }

    /* POST /internal/tags ["/music/a.flac", …] from the Node server (loopback, with the front key):
       each file's reading, for the check that compares the two readers (lib/library/tagcheck.js). */
    public static void UseInternal(Microsoft.AspNetCore.Builder.WebApplication app)
    {
        app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Path.Value != "/internal/tags") { await next(); return; }
            var from = ctx.Connection.RemoteIpAddress;
            var key = ctx.Request.Headers["X-Mandarin-Front-Key"].ToString();
            if (from == null || !System.Net.IPAddress.IsLoopback(from) || !Microsoft.AspNetCore.Http.HttpMethods.IsPost(ctx.Request.Method)
                || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(Library.FrontKey)))
            {
                ctx.Response.StatusCode = 404;
                return;
            }
            System.Text.Json.Nodes.JsonArray? items = null;
            try { items = await System.Text.Json.Nodes.JsonNode.ParseAsync(ctx.Request.Body) as System.Text.Json.Nodes.JsonArray; }
            catch (System.Text.Json.JsonException) { /* none */ }
            var paths = (items ?? []).Select(n => n is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<string>(out var s) ? s : null)
                .Where(s => !string.IsNullOrEmpty(s)).Take(500).ToList();
            var lines = await Task.Run(() => paths.Select(p => Line(p!)).ToList());
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync("[" + string.Join(",", lines) + "]");
        });
    }

    /* One file's reading as a line of JSON: { path, ok, tags } or { path, ok: false, error }. */
    public static string Line(string path)
    {
        var sb = new StringBuilder("{\"path\":");
        Js.Quote(sb, path);
        try
        {
            var r = ReadTags(path);
            sb.Append(",\"ok\":true,\"tags\":").Append(ToJson(r)).Append('}');
        }
        catch (Exception e)
        {
            sb.Clear().Append("{\"path\":");
            Js.Quote(sb, path);
            sb.Append(",\"ok\":false,\"error\":");
            Js.Quote(sb, e is JsError ? e.Message : e.GetType().Name + ": " + e.Message);
            sb.Append('}');
        }
        return sb.ToString();
    }

    /* The result as JSON, for comparing: a BigInt and a non-finite number written as the Node side writes them. */
    public static string ToJson(object? v)
    {
        var sb = new StringBuilder();
        Write(sb, v);
        return sb.ToString();
    }

    private static void Write(StringBuilder sb, object? v)
    {
        switch (v)
        {
            case BigInteger b:
                sb.Append("{\"$bigint\":");
                Js.Quote(sb, b.ToString(CultureInfo.InvariantCulture));
                sb.Append('}');
                return;
            case double d when !double.IsFinite(d):
                sb.Append("{\"$num\":");
                Js.Quote(sb, Js.Num(d));
                sb.Append('}');
                return;
            case List<object?> l:
                sb.Append('[');
                for (var i = 0; i < l.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    if (l[i] is Undef) sb.Append("null"); else Write(sb, l[i]);
                }
                sb.Append(']');
                return;
            case JsObj o:
            {
                sb.Append('{');
                var first = true;
                foreach (var k in o.Keys)
                {
                    var x = o[k];
                    if (x is Undef) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    Js.Quote(sb, k);
                    sb.Append(':');
                    Write(sb, x);
                }
                sb.Append('}');
                return;
            }
            default:
                sb.Append(Js.Json(v) ?? "null");
                return;
        }
    }
}

/* file-type 21's guess from a file's first 4100 bytes, for the formats a music folder holds. */
internal static class Sniff
{
    private static bool At(U8 b, int off, params byte[] sig)
    {
        for (var i = 0; i < sig.Length; i++) if ((b.Get(off + i) ?? -1) != sig[i]) return false;
        return true;
    }

    private static bool AtStr(U8 b, int off, string s) => At(b, off, s.Select(c => (byte)c).ToArray());

    public static string? Mime(U8 buf) => Detect(buf, 0, 0);

    private static string? Detect(U8 buf, int pos, int depth)
    {
        if (depth > 256) return null;
        var b = buf.Sub(pos);
        if (At(b, 0, 0xEF, 0xBB, 0xBF)) return Detect(buf, pos + 3, depth + 1);
        if (AtStr(b, 0, "ID3"))
        {
            if (b.Length < 10) return null;
            var len = (b.At(9) & 0x7F) | (b.At(8) << 7) | (b.At(7) << 14) | (b.At(6) << 21);
            if (pos + 10 + (long)len > buf.Length) return "audio/mpeg";
            return Detect(buf, pos + 10 + len, depth + 1);
        }
        if (AtStr(b, 0, "MP+")) return "audio/x-musepack";
        if (AtStr(b, 0, "MPCK")) return "audio/x-musepack";
        if (AtStr(b, 0, "FORM")) return "audio/aiff";
        if (AtStr(b, 0, "OggS"))
        {
            var t = b.Sub(28, 36);
            if (At(t, 0, 0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64)) return "audio/ogg; codecs=opus";
            if (At(t, 0, 0x80, 0x74, 0x68, 0x65, 0x6F, 0x72, 0x61)) return "video/ogg";
            if (At(t, 0, 0x01, 0x76, 0x69, 0x64, 0x65, 0x6F, 0x00)) return "video/ogg";
            if (At(t, 0, 0x7F, 0x46, 0x4C, 0x41, 0x43)) return "audio/ogg";
            if (At(t, 0, 0x53, 0x70, 0x65, 0x65, 0x78, 0x20, 0x20)) return "audio/ogg";
            if (At(t, 0, 0x01, 0x76, 0x6F, 0x72, 0x62, 0x69, 0x73)) return "audio/ogg";
            return "application/ogg";
        }
        if (AtStr(b, 0, "DSD ")) return "audio/x-dsf";
        if (AtStr(b, 0, "fLaC")) return "audio/flac";
        if (AtStr(b, 0, "wvpk")) return "audio/wavpack";
        if (AtStr(b, 0, "MAC ")) return "audio/ape";
        if (At(b, 0, 0x1A, 0x45, 0xDF, 0xA3)) return "video/matroska";
        if (AtStr(b, 4, "ftyp") && ((b.Get(8) ?? 0) & 0x60) != 0)
        {
            var brand = Text.Decode(b.Sub(8, 12), "latin1");
            var nul = brand.IndexOf('\0');
            if (nul >= 0) brand = brand.Remove(nul, 1).Insert(nul, " ");
            brand = Js.Trim(brand);
            return brand switch
            {
                "avif" or "avis" => "image/avif",
                "mif1" => "image/heif",
                "msf1" => "image/heif-sequence",
                "heic" or "heix" => "image/heic",
                "hevc" or "hevx" => "image/heic-sequence",
                "qt" => "video/quicktime",
                "M4V" or "M4VH" or "M4VP" => "video/x-m4v",
                "M4P" => "video/mp4",
                "M4B" => "audio/mp4",
                "M4A" => "audio/x-m4a",
                "F4V" or "F4P" => "video/mp4",
                "F4A" or "F4B" => "audio/mp4",
                "crx" => "image/x-canon-cr3",
                _ => brand.StartsWith("3g2", StringComparison.Ordinal) ? "video/3gpp2" : brand.StartsWith("3g", StringComparison.Ordinal) ? "video/3gpp" : "video/mp4"
            };
        }
        if (AtStr(b, 0, "RIFF"))
        {
            if (AtStr(b, 8, "WEBP")) return "image/webp";
            if (At(b, 8, 0x41, 0x56, 0x49)) return "video/vnd.avi";
            if (AtStr(b, 8, "WAVE")) return "audio/wav";
            if (AtStr(b, 8, "QLCM")) return "audio/qcelp";
        }
        if (At(b, 0, 0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9)) return "audio/x-ms-asf";
        // detectImprecise: an MPEG frame within the first 12 bytes.
        for (var depth2 = 0; depth2 <= 10; depth2++)
        {
            var x = b.Get(depth2) ?? 0;
            var y = b.Get(depth2 + 1) ?? 0;
            if (x != 0xFF || (y & 0xE0) != 0xE0) continue;
            if ((y & 0x16) == 0x10) return "audio/aac";
            if ((y & 0x06) is 0x02 or 0x04 or 0x06) return "audio/mpeg";
        }
        return null;
    }
}
