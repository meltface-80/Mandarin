// WebUrl.cs — `new URL(input, base).toString()` and `new URL(s).hostname` as
// Node gives them (v0.8.37, stage 2a of docs/specs/csharp-migration.md): for
// lib/renderers/description.js, which resolves every address a device
// describes against its URLBase or the description's own, and for a Sonos
// player's address, the host of its Location (Topology.cs).
//
// Node's URL is the WHATWG URL Standard (the ada parser), and so is this: the
// basic URL parser, state by state, and its serializer. So a device's sloppy
// addresses come out as they do there: tabs and newlines dropped, backslashes
// read as slashes, dot segments (%2e too) resolved, default ports dropped,
// "192.168.001.020" read as an IPv4 address with an octal part, spaces and
// other characters percent-encoded by the part they sit in.
//
// Where ada (2.9.2, in Node 20 and 22) reads otherwise than the standard's
// text, this reads as ada does: a last ".." in a URL that isn't special leaves
// no empty segment unless it took one away ("sc://h/.." is "sc://h"); a file
// path's first segment is kept from ".." (and carried over from a file base)
// when it only starts with a drive letter ("file:///c:x/../y" is
// "file:///c:x/y"). One ada
// slip is not copied: a relative reference with a "#" past its start, against
// a base with an opaque path ("x#f" on "mailto:a"), which ada takes and the
// standard (and ada, without the "#") refuses; it fails here.
//
// One difference: a host with letters outside ASCII goes through .NET's IDNA
// (ICU's UTS #46), label by label, where Node has its own tables; .NET turns
// down a few such labels WHATWG takes (one beginning or ending with a hyphen,
// one over 63 letters), and doesn't apply the bidi rule across labels. An
// ASCII "xn--" label is checked here as real Punycode of something UTS #46
// lets through, as Node checks it. ASCII hosts, which is what devices on a
// network give, are read exactly.
using System.Globalization;
using System.Text;

namespace Mandarin.Server.Playback;

internal static class WebUrl
{
    /* new URL(input, base).toString(), or null where it throws; base null: none given. */
    public static string? Href(string input, string? baseUrl)
    {
        Record? b = null;
        if (baseUrl != null && (b = Parse(baseUrl, null)) == null) return null;
        return Parse(input, b)?.Serialize();
    }

    /* new URL(input).hostname ("" for a URL without a host), or null where the constructor throws. */
    public static string? Hostname(string input) => Parse(input, null) is { } r ? r.Host ?? "" : null;

    private sealed class Record
    {
        public string Scheme = "", Username = "", Password = "";
        public string? Host;                 // serialized; null for none
        public int? Port;
        public List<string> Path = [];
        public string? Opaque;               // an opaque path, in place of Path
        public string? Query, Fragment;
        public bool Special => DefaultPort(Scheme) != -2;

        public string Serialize()
        {
            var sb = new StringBuilder(Scheme).Append(':');
            if (Host != null)
            {
                sb.Append("//");
                if (Username.Length > 0 || Password.Length > 0)
                {
                    sb.Append(Username);
                    if (Password.Length > 0) sb.Append(':').Append(Password);
                    sb.Append('@');
                }
                sb.Append(Host);
                if (Port != null) sb.Append(':').Append(Port.Value.ToString(CultureInfo.InvariantCulture));
            }
            if (Opaque != null) sb.Append(Opaque);
            else
            {
                if (Host == null && Path.Count > 1 && Path[0].Length == 0) sb.Append("/.");
                foreach (var seg in Path) sb.Append('/').Append(seg);
            }
            if (Query != null) sb.Append('?').Append(Query);
            if (Fragment != null) sb.Append('#').Append(Fragment);
            return sb.ToString();
        }
    }

    // A special scheme's default port: -1 for file (none), -2 for a scheme that isn't special.
    private static int DefaultPort(string scheme) => scheme switch
    {
        "http" or "ws" => 80,
        "https" or "wss" => 443,
        "ftp" => 21,
        "file" => -1,
        _ => -2
    };

    private const int Eof = -1;

    private enum State
    {
        SchemeStart, Scheme, NoScheme, SpecialRelativeOrAuthority, PathOrAuthority, Relative, RelativeSlash,
        SpecialAuthoritySlashes, SpecialAuthorityIgnoreSlashes, Authority, Host, Port, File, FileSlash, FileHost,
        PathStart, Path, OpaquePath, Query, Fragment
    }

    private static bool Alpha(int c) => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z';
    private static bool Digit(int c) => c is >= '0' and <= '9';
    private static bool Hex(int c) => Digit(c) || c is >= 'A' and <= 'F' or >= 'a' and <= 'f';
    private static int HexValue(int c) => Digit(c) ? c - '0' : (c | 0x20) - 'a' + 10;
    private static int Lower(int c) => c is >= 'A' and <= 'Z' ? c | 0x20 : c;

    // The percent-encode sets.
    private static bool C0Set(int c) => c < 0x20 || c > 0x7E;
    private static bool FragmentSet(int c) => C0Set(c) || c is ' ' or '"' or '<' or '>' or '`';
    private static bool QuerySet(int c) => C0Set(c) || c is ' ' or '"' or '#' or '<' or '>';
    private static bool SpecialQuerySet(int c) => QuerySet(c) || c == '\'';
    private static bool PathSet(int c) => QuerySet(c) || c is '?' or '`' or '{' or '}';
    private static bool UserinfoSet(int c) => PathSet(c) || c is '/' or ':' or ';' or '=' or '@' or >= '[' and <= '^' or '|';

    private static void Encode(StringBuilder sb, int c, Func<int, bool> set)
    {
        if (!set(c)) { sb.Append(char.ConvertFromUtf32(c)); return; }
        Span<byte> bytes = stackalloc byte[4];
        var n = new Rune(c).EncodeToUtf8(bytes);
        for (var i = 0; i < n; i++) sb.Append('%').Append("0123456789ABCDEF"[bytes[i] >> 4]).Append("0123456789ABCDEF"[bytes[i] & 15]);
    }

    private static string EncodeAll(string s, Func<int, bool> set)
    {
        var sb = new StringBuilder();
        foreach (var r in s.EnumerateRunes()) Encode(sb, r.Value, set);
        return sb.ToString();
    }

    private static int CodePoints(string s)
    {
        var n = 0;
        foreach (var _ in s.EnumerateRunes()) n++;
        return n;
    }

    // A Windows drive letter: a letter, then ":" or "|".
    private static bool DriveLetter(string s) => s.Length == 2 && Alpha(s[0]) && (s[1] == ':' || s[1] == '|');

    // A file path's first segment taken for a normalized drive letter, as ada takes it: a letter and
    // ":" at its start, whatever follows ("c:x" too), where the standard asks for exactly two.
    private static bool DrivePrefix(string s) => s.Length >= 2 && Alpha(s[0]) && s[1] == ':';

    private static bool StartsWithDriveLetter(int[] cp, int p)
    {
        var left = cp.Length - p;
        return left >= 2 && Alpha(cp[p]) && (cp[p + 1] == ':' || cp[p + 1] == '|')
            && (left == 2 || cp[p + 2] is '/' or '\\' or '?' or '#');
    }

    private static bool SingleDot(string s) => s == "." || s.Equals("%2e", StringComparison.OrdinalIgnoreCase);
    private static bool DoubleDot(string s) => s switch
    {
        ".." => true,
        _ => s.Length is 4 or 6 && (s.ToLowerInvariant() is ".%2e" or "%2e." or "%2e%2e")
    };

    private static void Shorten(Record url)
    {
        if (url.Scheme == "file" && url.Path.Count == 1 && DrivePrefix(url.Path[0])) return;
        if (url.Path.Count > 0) url.Path.RemoveAt(url.Path.Count - 1);
    }

    // The input as code points: lone surrogates made U+FFFD (a USVString), C0 controls and spaces
    // trimmed from both ends, tabs and newlines dropped throughout.
    private static int[] Prepare(string input)
    {
        var all = new List<int>(input.Length);
        for (var i = 0; i < input.Length; i++)
        {
            var c = input[i];
            if (char.IsHighSurrogate(c) && i + 1 < input.Length && char.IsLowSurrogate(input[i + 1])) { all.Add(char.ConvertToUtf32(c, input[i + 1])); i++; }
            else all.Add(char.IsSurrogate(c) ? 0xFFFD : c);
        }
        int a = 0, b = all.Count;
        while (a < b && all[a] <= 0x20) a++;
        while (b > a && all[b - 1] <= 0x20) b--;
        var cp = new List<int>(b - a);
        for (var i = a; i < b; i++) if (all[i] is not (0x09 or 0x0A or 0x0D)) cp.Add(all[i]);
        return cp.ToArray();
    }

    private static Record? Parse(string input, Record? b)
    {
        var cp = Prepare(input);
        var n = cp.Length;
        var url = new Record();
        var state = State.SchemeStart;
        StringBuilder buffer = new(), opaque = new(), fragment = new();
        bool atSignSeen = false, insideBrackets = false, passwordTokenSeen = false;
        bool Next(int p, int ch) => p + 1 < n && cp[p + 1] == ch;
        for (var p = 0; ; p++)
        {
            var c = p >= 0 && p < n ? cp[p] : Eof;
            switch (state)
            {
                case State.SchemeStart:
                    if (Alpha(c)) { buffer.Append((char)Lower(c)); state = State.Scheme; }
                    else { state = State.NoScheme; p--; }
                    break;

                case State.Scheme:
                    if (Alpha(c) || Digit(c) || c is '+' or '-' or '.') buffer.Append((char)Lower(c));
                    else if (c == ':')
                    {
                        url.Scheme = buffer.ToString();
                        buffer.Clear();
                        if (url.Scheme == "file") state = State.File;
                        else if (url.Special && b != null && b.Scheme == url.Scheme) state = State.SpecialRelativeOrAuthority;
                        else if (url.Special) state = State.SpecialAuthoritySlashes;
                        else if (Next(p, '/')) { state = State.PathOrAuthority; p++; }
                        else { url.Opaque = ""; state = State.OpaquePath; }
                    }
                    else { buffer.Clear(); state = State.NoScheme; p = -1; }
                    break;

                case State.NoScheme:
                    if (b == null || (b.Opaque != null && c != '#')) return null;
                    if (b.Opaque != null)
                    {
                        url.Scheme = b.Scheme;
                        url.Opaque = b.Opaque;
                        url.Query = b.Query;
                        url.Fragment = "";
                        state = State.Fragment;
                    }
                    else { state = b.Scheme != "file" ? State.Relative : State.File; p--; }
                    break;

                case State.SpecialRelativeOrAuthority:
                    if (c == '/' && Next(p, '/')) { state = State.SpecialAuthorityIgnoreSlashes; p++; }
                    else { state = State.Relative; p--; }
                    break;

                case State.PathOrAuthority:
                    if (c == '/') state = State.Authority;
                    else { state = State.Path; p--; }
                    break;

                case State.Relative:
                    url.Scheme = b!.Scheme;
                    if (c == '/' || (url.Special && c == '\\')) state = State.RelativeSlash;
                    else
                    {
                        url.Username = b.Username; url.Password = b.Password; url.Host = b.Host; url.Port = b.Port;
                        url.Path = [.. b.Path]; url.Query = b.Query;
                        if (c == '?') { url.Query = ""; state = State.Query; }
                        else if (c == '#') { url.Fragment = ""; state = State.Fragment; }
                        else if (c != Eof) { url.Query = null; Shorten(url); state = State.Path; p--; }
                    }
                    break;

                case State.RelativeSlash:
                    if (url.Special && (c == '/' || c == '\\')) state = State.SpecialAuthorityIgnoreSlashes;
                    else if (c == '/') state = State.Authority;
                    else
                    {
                        url.Username = b!.Username; url.Password = b.Password; url.Host = b.Host; url.Port = b.Port;
                        state = State.Path; p--;
                    }
                    break;

                case State.SpecialAuthoritySlashes:
                    state = State.SpecialAuthorityIgnoreSlashes;
                    if (c == '/' && Next(p, '/')) p++;
                    else p--;
                    break;

                case State.SpecialAuthorityIgnoreSlashes:
                    if (c != '/' && c != '\\') { state = State.Authority; p--; }
                    break;

                case State.Authority:
                    if (c == '@')
                    {
                        if (atSignSeen) buffer.Insert(0, "%40");
                        atSignSeen = true;
                        var user = new StringBuilder(url.Username);
                        var pass = new StringBuilder(url.Password);
                        foreach (var r in buffer.ToString().EnumerateRunes())
                        {
                            if (r.Value == ':' && !passwordTokenSeen) { passwordTokenSeen = true; continue; }
                            Encode(passwordTokenSeen ? pass : user, r.Value, UserinfoSet);
                        }
                        url.Username = user.ToString();
                        url.Password = pass.ToString();
                        buffer.Clear();
                    }
                    else if (c is Eof or '/' or '?' or '#' || (url.Special && c == '\\'))
                    {
                        if (atSignSeen && buffer.Length == 0) return null;
                        p -= CodePoints(buffer.ToString()) + 1;
                        buffer.Clear();
                        state = State.Host;
                    }
                    else buffer.Append(char.ConvertFromUtf32(c));
                    break;

                case State.Host:
                    if (c == ':' && !insideBrackets)
                    {
                        if (buffer.Length == 0) return null;
                        var host = ParseHost(buffer.ToString(), !url.Special);
                        if (host == null) return null;
                        url.Host = host;
                        buffer.Clear();
                        state = State.Port;
                    }
                    else if (c is Eof or '/' or '?' or '#' || (url.Special && c == '\\'))
                    {
                        p--;
                        if (url.Special && buffer.Length == 0) return null;
                        var host = ParseHost(buffer.ToString(), !url.Special);
                        if (host == null) return null;
                        url.Host = host;
                        buffer.Clear();
                        state = State.PathStart;
                    }
                    else
                    {
                        if (c == '[') insideBrackets = true;
                        if (c == ']') insideBrackets = false;
                        buffer.Append(char.ConvertFromUtf32(c));
                    }
                    break;

                case State.Port:
                    if (Digit(c)) buffer.Append((char)c);
                    else if (c is Eof or '/' or '?' or '#' || (url.Special && c == '\\'))
                    {
                        if (buffer.Length > 0)
                        {
                            long port = 0;
                            foreach (var d in buffer.ToString()) { port = port * 10 + (d - '0'); if (port > 65535) return null; }
                            url.Port = port == DefaultPort(url.Scheme) ? null : (int)port;
                            buffer.Clear();
                        }
                        state = State.PathStart;
                        p--;
                    }
                    else return null;
                    break;

                case State.File:
                    url.Scheme = "file";
                    url.Host = "";
                    if (c == '/' || c == '\\') state = State.FileSlash;
                    else if (b != null && b.Scheme == "file")
                    {
                        url.Host = b.Host; url.Path = [.. b.Path]; url.Query = b.Query;
                        if (c == '?') { url.Query = ""; state = State.Query; }
                        else if (c == '#') { url.Fragment = ""; state = State.Fragment; }
                        else if (c != Eof)
                        {
                            url.Query = null;
                            if (!StartsWithDriveLetter(cp, p)) Shorten(url);
                            else url.Path = [];
                            state = State.Path;
                            p--;
                        }
                    }
                    else { state = State.Path; p--; }
                    break;

                case State.FileSlash:
                    if (c == '/' || c == '\\') state = State.FileHost;
                    else
                    {
                        if (b != null && b.Scheme == "file")
                        {
                            url.Host = b.Host;
                            if (!StartsWithDriveLetter(cp, p) && b.Path.Count > 0 && DrivePrefix(b.Path[0])) url.Path.Add(b.Path[0]);
                        }
                        state = State.Path;
                        p--;
                    }
                    break;

                case State.FileHost:
                    if (c is Eof or '/' or '\\' or '?' or '#')
                    {
                        p--;
                        // A drive letter where a host would be: kept in buffer, for the path.
                        if (DriveLetter(buffer.ToString())) state = State.Path;
                        else if (buffer.Length == 0) { url.Host = ""; state = State.PathStart; }
                        else
                        {
                            var host = ParseHost(buffer.ToString(), false);
                            if (host == null) return null;
                            url.Host = host == "localhost" ? "" : host;
                            buffer.Clear();
                            state = State.PathStart;
                        }
                    }
                    else buffer.Append(char.ConvertFromUtf32(c));
                    break;

                case State.PathStart:
                    if (url.Special)
                    {
                        state = State.Path;
                        if (c != '/' && c != '\\') p--;
                    }
                    else if (c == '?') { url.Query = ""; state = State.Query; }
                    else if (c == '#') { url.Fragment = ""; state = State.Fragment; }
                    else if (c != Eof)
                    {
                        state = State.Path;
                        if (c != '/') p--;
                    }
                    break;

                case State.Path:
                    if (c is Eof or '/' or '?' or '#' || (url.Special && c == '\\'))
                    {
                        var seg = buffer.ToString();
                        var slash = c == '/' || (url.Special && c == '\\');
                        if (DoubleDot(seg))
                        {
                            // As ada has it: a last ".." in a URL that isn't special leaves an empty
                            // segment only when it took one away ("sc://h/.." is "sc://h").
                            var before = url.Path.Count;
                            Shorten(url);
                            if (!slash && (url.Special || url.Path.Count < before)) url.Path.Add("");
                        }
                        else if (SingleDot(seg) && !slash) url.Path.Add("");
                        else if (!SingleDot(seg))
                        {
                            if (url.Scheme == "file" && url.Path.Count == 0 && DriveLetter(seg)) seg = seg[0] + ":";
                            url.Path.Add(seg);
                        }
                        buffer.Clear();
                        if (c == '?') { url.Query = ""; state = State.Query; }
                        if (c == '#') { url.Fragment = ""; state = State.Fragment; }
                    }
                    else Encode(buffer, c, PathSet);
                    break;

                case State.OpaquePath:
                    if (c == '?') { url.Query = ""; state = State.Query; }
                    else if (c == '#') { url.Fragment = ""; state = State.Fragment; }
                    else if (c != Eof) Encode(opaque, c, C0Set);
                    break;

                case State.Query:
                    if (c is '#' or Eof)
                    {
                        url.Query += EncodeAll(buffer.ToString(), url.Special ? SpecialQuerySet : QuerySet);
                        buffer.Clear();
                        if (c == '#') { url.Fragment = ""; state = State.Fragment; }
                    }
                    else buffer.Append(char.ConvertFromUtf32(c));
                    break;

                case State.Fragment:
                    if (c != Eof) Encode(fragment, c, FragmentSet);
                    break;
            }
            if (p >= n) break;
        }
        // The opaque path and the fragment, gathered as they came (both run to the end, or to "?" or "#").
        if (opaque.Length > 0) url.Opaque += opaque.ToString();
        if (fragment.Length > 0) url.Fragment += fragment.ToString();
        return url;
    }

    // ------------------------------------------------------------------ hosts

    private static bool ForbiddenHost(int c) => c is 0 or 0x09 or 0x0A or 0x0D or ' ' or '#' or '/' or ':' or '<' or '>' or '?' or '@' or '[' or '\\' or ']' or '^' or '|';
    private static bool ForbiddenDomain(int c) => ForbiddenHost(c) || c <= 0x1F || c == '%' || c == 0x7F;

    private static string? ParseHost(string input, bool opaque)
    {
        if (input.StartsWith('['))
        {
            if (!input.EndsWith(']')) return null;
            var a = ParseIpv6(input[1..^1]);
            return a == null ? null : "[" + SerializeIpv6(a) + "]";
        }
        if (opaque)
        {
            foreach (var r in input.EnumerateRunes()) if (ForbiddenHost(r.Value)) return null;
            return EncodeAll(input, C0Set);
        }
        var domain = new UTF8Encoding(false, false).GetString(PercentDecode(input));
        var ascii = DomainToAscii(domain);
        if (ascii == null) return null;
        if (EndsInNumber(ascii))
        {
            var v4 = ParseIpv4(ascii);
            if (v4 is not { } v) return null;
            return string.Join(".", new[] { v >> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255 }.Select(x => x.ToString(CultureInfo.InvariantCulture)));
        }
        return ascii;
    }

    private static byte[] PercentDecode(string s)
    {
        var bytes = Encoding.UTF8.GetBytes(s);
        var o = new List<byte>(bytes.Length);
        for (var i = 0; i < bytes.Length; i++)
        {
            if (bytes[i] == '%' && i + 2 < bytes.Length && Hex(bytes[i + 1]) && Hex(bytes[i + 2]))
            {
                o.Add((byte)(HexValue(bytes[i + 1]) * 16 + HexValue(bytes[i + 2])));
                i += 2;
            }
            else o.Add(bytes[i]);
        }
        return o.ToArray();
    }

    private static readonly IdnMapping Idn = new() { AllowUnassigned = false, UseStd3AsciiRules = false };

    /* domain to ASCII (UTS 46, non-transitional, no hyphen, STD3 or length checks). */
    private static string? DomainToAscii(string domain)
    {
        var labels = new List<string>();
        var label = new StringBuilder();
        foreach (var c in domain)
        {
            if (c is '.' or '。' or '．' or '｡') { labels.Add(label.ToString()); label.Clear(); }
            else label.Append(c);
        }
        labels.Add(label.ToString());
        for (var i = 0; i < labels.Count; i++)
        {
            var l = labels[i];
            if (l.All(char.IsAscii))
            {
                l = AsciiLower(l);
                if (l.StartsWith("xn--", StringComparison.Ordinal) && !PunycodeOk(l[4..])) return null;
                labels[i] = l;
                continue;
            }
            try { labels[i] = AsciiLower(Idn.GetAscii(l)); }
            catch (ArgumentException) { return null; }
        }
        var result = string.Join(".", labels);
        if (result.Length == 0) return null;
        foreach (var r in result.EnumerateRunes()) if (ForbiddenDomain(r.Value)) return null;
        return result;
    }

    /* An xn-- label: real Punycode, of something UTS 46 lets through. */
    private static bool PunycodeOk(string code)
    {
        var decoded = Punycode(code);
        if (decoded == null || decoded.Length == 0) return false;
        if (decoded.All(char.IsAscii)) return true;
        try { Idn.GetAscii(decoded); return true; }
        catch (ArgumentException) { return false; }
    }

    /* RFC 3492's decoder; null when the code is not Punycode. */
    private static string? Punycode(string input)
    {
        const int Base = 36, TMin = 1, TMax = 26, Skew = 38, Damp = 700;
        var output = new List<int>();
        var d = input.LastIndexOf('-');
        if (d > 0) foreach (var c in input[..d]) { if (c >= 0x80) return null; output.Add(c); }
        long n = 128, i = 0, bias = 72;
        var p = d > 0 ? d + 1 : 0;
        while (p < input.Length)
        {
            long oldi = i, w = 1;
            for (long k = Base; ; k += Base)
            {
                if (p >= input.Length) return null;
                var c = input[p++];
                int digit = c >= '0' && c <= '9' ? c - '0' + 26 : c >= 'a' && c <= 'z' ? c - 'a' : c >= 'A' && c <= 'Z' ? c - 'A' : -1;
                if (digit < 0) return null;
                i += digit * w;
                if (i > int.MaxValue) return null;
                var t = k <= bias ? TMin : k >= bias + TMax ? TMax : k - bias;
                if (digit < t) break;
                w *= Base - t;
                if (w > int.MaxValue) return null;
            }
            var len = output.Count + 1;
            var delta = oldi == 0 ? (i - oldi) / Damp : (i - oldi) / 2;
            delta += delta / len;
            long kk = 0;
            while (delta > ((Base - TMin) * TMax) / 2) { delta /= Base - TMin; kk += Base; }
            bias = kk + (Base - TMin + 1) * delta / (delta + Skew);
            n += i / len;
            i %= len;
            if (n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return null;
            output.Insert((int)i, (int)n);
            i++;
        }
        var sb = new StringBuilder();
        foreach (var cp in output) sb.Append(char.ConvertFromUtf32(cp));
        return sb.ToString();
    }

    private static string AsciiLower(string s) => string.Create(s.Length, s, (span, v) =>
    {
        for (var i = 0; i < v.Length; i++) span[i] = v[i] is >= 'A' and <= 'Z' ? (char)(v[i] | 0x20) : v[i];
    });

    private static bool EndsInNumber(string s)
    {
        var parts = s.Split('.').ToList();
        if (parts[^1].Length == 0)
        {
            if (parts.Count == 1) return false;
            parts.RemoveAt(parts.Count - 1);
        }
        var last = parts[^1];
        if (last.Length > 0 && last.All(ch => ch is >= '0' and <= '9')) return true;
        return Ipv4Number(last) != null;
    }

    // An IPv4 part: decimal, 0x hex or 0 octal; capped above 2^32 (all the checks need).
    private static long? Ipv4Number(string s)
    {
        if (s.Length == 0) return null;
        var radix = 10;
        if (s.Length >= 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) { s = s[2..]; radix = 16; }
        else if (s.Length >= 2 && s[0] == '0') { s = s[1..]; radix = 8; }
        if (s.Length == 0) return 0;
        long v = 0;
        foreach (var ch in s)
        {
            var d = ch is >= '0' and <= '9' ? ch - '0' : (ch | 0x20) is >= 'a' and <= 'f' ? (ch | 0x20) - 'a' + 10 : 99;
            if (d >= radix) return null;
            v = Math.Min(v * radix + d, 1L << 40);
        }
        return v;
    }

    private static long? ParseIpv4(string s)
    {
        var parts = s.Split('.').ToList();
        if (parts[^1].Length == 0 && parts.Count > 1) parts.RemoveAt(parts.Count - 1);
        if (parts.Count > 4) return null;
        var numbers = new List<long>();
        foreach (var part in parts)
        {
            var v = Ipv4Number(part);
            if (v == null) return null;
            numbers.Add(v.Value);
        }
        for (var i = 0; i < numbers.Count - 1; i++) if (numbers[i] > 255) return null;
        if (numbers[^1] >= (long)Math.Pow(256, 5 - numbers.Count)) return null;
        var ipv4 = numbers[^1];
        for (var i = 0; i < numbers.Count - 1; i++) ipv4 += numbers[i] * (long)Math.Pow(256, 3 - i);
        return ipv4;
    }

    private static ushort[]? ParseIpv6(string input)
    {
        var cp = new List<int>();
        foreach (var r in input.EnumerateRunes()) cp.Add(r.Value);
        int C(int i) => i < cp.Count ? cp[i] : Eof;
        var address = new ushort[8];
        int piece = 0, p = 0;
        int? compress = null;
        if (C(p) == ':')
        {
            if (C(p + 1) != ':') return null;
            p += 2;
            compress = ++piece;
        }
        while (C(p) != Eof)
        {
            if (piece == 8) return null;
            if (C(p) == ':')
            {
                if (compress != null) return null;
                p++;
                compress = ++piece;
                continue;
            }
            int value = 0, length = 0;
            while (length < 4 && Hex(C(p))) { value = value * 16 + HexValue(C(p)); p++; length++; }
            if (C(p) == '.')
            {
                if (length == 0) return null;
                p -= length;
                if (piece > 6) return null;
                var seen = 0;
                while (C(p) != Eof)
                {
                    int? v4 = null;
                    if (seen > 0)
                    {
                        if (C(p) == '.' && seen < 4) p++;
                        else return null;
                    }
                    if (!Digit(C(p))) return null;
                    while (Digit(C(p)))
                    {
                        var number = C(p) - '0';
                        if (v4 == null) v4 = number;
                        else if (v4 == 0) return null;
                        else v4 = v4 * 10 + number;
                        if (v4 > 255) return null;
                        p++;
                    }
                    address[piece] = (ushort)(address[piece] * 0x100 + v4!.Value);
                    seen++;
                    if (seen is 2 or 4) piece++;
                }
                if (seen != 4) return null;
                break;
            }
            else if (C(p) == ':')
            {
                p++;
                if (C(p) == Eof) return null;
            }
            else if (C(p) != Eof) return null;
            address[piece] = (ushort)value;
            piece++;
        }
        if (compress != null)
        {
            var swaps = piece - compress.Value;
            piece = 7;
            while (piece != 0 && swaps > 0)
            {
                (address[piece], address[compress.Value + swaps - 1]) = (address[compress.Value + swaps - 1], address[piece]);
                piece--;
                swaps--;
            }
        }
        else if (piece != 8) return null;
        return address;
    }

    private static string SerializeIpv6(ushort[] a)
    {
        // The first longest run of two or more zero pieces is written "::".
        int? compress = null;
        int bestLen = 1;
        for (var i = 0; i < 8;)
        {
            if (a[i] != 0) { i++; continue; }
            var j = i;
            while (j < 8 && a[j] == 0) j++;
            if (j - i > bestLen) { bestLen = j - i; compress = i; }
            i = j;
        }
        var sb = new StringBuilder();
        var ignore0 = false;
        for (var i = 0; i < 8; i++)
        {
            if (ignore0 && a[i] == 0) continue;
            ignore0 = false;
            if (compress == i)
            {
                sb.Append(i == 0 ? "::" : ":");
                ignore0 = true;
                continue;
            }
            sb.Append(a[i].ToString("x", CultureInfo.InvariantCulture));
            if (i != 7) sb.Append(':');
        }
        return sb.ToString();
    }
}
