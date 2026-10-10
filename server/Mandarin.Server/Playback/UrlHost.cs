// UrlHost.cs — `new URL(s).hostname` as JavaScript gives it (the WHATWG URL
// Standard, which Node follows), for the ports that read a player's address
// out of its Location (Topology.cs, v0.8.37). System.Uri reads addresses its
// own way; this reads only as far as the host, but by the Standard's steps,
// so the same text gives the same host or the same failure (null, where the
// URL constructor throws):
//
//   - leading and trailing control characters and spaces dropped, tabs and
//     newlines dropped anywhere; a scheme is required;
//   - http, https, ws, wss and ftp: any slashes or backslashes, user:password@
//     dropped, the host percent-decoded, lowercased (international names in
//     punycode), refused if it holds a character no host may, read as IPv4 if
//     it ends in a number (0x7f.1 is 127.0.0.1; 10.0.0.256 is refused), a port
//     above 65535 or not a number refused;
//   - [IPv6] compressed as the Standard writes it; file: has a host only after
//     "//" ("localhost" is none); any other scheme keeps its host as written,
//     percent-encoded, or has none.
//
// International names go through ICU's UTS 46 (IdnMapping) a label at a time;
// Node has its own tables. The two agree on the names a network carries
// (münchen.de, 日本.jp, full-width letters); on invented ones (a label that
// begins with a hyphen and holds non-ASCII letters, an xn-- label that isn't
// a real encoding) they may not.
using System.Globalization;
using System.Text;

namespace Mandarin.Server.Playback;

internal static class UrlHost
{
    private const int Eof = -1;

    public static string? Hostname(string input)
    {
        // USVString: a lone surrogate is U+FFFD.
        var sb = new StringBuilder(input.Length);
        for (var i = 0; i < input.Length; i++)
        {
            var c = input[i];
            if (char.IsHighSurrogate(c) && i + 1 < input.Length && char.IsLowSurrogate(input[i + 1])) { sb.Append(c).Append(input[++i]); continue; }
            sb.Append(char.IsSurrogate(c) ? '�' : c);
        }
        var s0 = sb.ToString();
        int a = 0, b = s0.Length;
        while (a < b && s0[a] <= ' ') a++;
        while (b > a && s0[b - 1] <= ' ') b--;
        sb.Clear();
        for (var i = a; i < b; i++) if (s0[i] is not ('\t' or '\n' or '\r')) sb.Append(s0[i]);
        var s = sb.ToString();

        if (s.Length == 0 || !char.IsAsciiLetter(s[0])) return null;
        var p = 1;
        while (p < s.Length && (char.IsAsciiLetterOrDigit(s[p]) || s[p] is '+' or '-' or '.')) p++;
        if (p >= s.Length || s[p] != ':') return null;
        var scheme = s[..p].ToLowerInvariant();
        p++;
        if (scheme == "file") return FileHost(s, p);
        var special = scheme is "ftp" or "http" or "https" or "ws" or "wss";
        if (special)
        {
            while (p < s.Length && s[p] is '/' or '\\') p++;
            return Authority(s, p, true);
        }
        if (p < s.Length && s[p] == '/')
        {
            if (p + 1 < s.Length && s[p + 1] == '/') return Authority(s, p + 2, false);
            return "";
        }
        return "";   // an opaque path: no host
    }

    private static int At(string s, int i) => i < s.Length ? s[i] : Eof;
    private static bool Ends(int c, bool special) => c is Eof or '/' or '?' or '#' || (special && c == '\\');

    /* The authority state: what follows the last "@" is the host (and port). */
    private static string? Authority(string s, int p, bool special)
    {
        var start = p;
        var at = false;
        for (; ; p++)
        {
            var c = At(s, p);
            if (c == '@') { at = true; start = p + 1; continue; }
            if (Ends(c, special))
            {
                if (at && p == start) return null;
                return HostState(s, start, special);
            }
        }
    }

    private static string? HostState(string s, int p, bool special)
    {
        var buf = new StringBuilder();
        var brackets = false;
        for (; ; p++)
        {
            var c = At(s, p);
            if (c == ':' && !brackets)
            {
                if (buf.Length == 0) return null;
                var host = ParseHost(buf.ToString(), !special);
                if (host == null) return null;
                // The port: digits only, at most 65535.
                p++;
                var digits = 0;
                long port = 0;
                while (p < s.Length && char.IsAsciiDigit(s[p])) { port = Math.Min(port * 10 + (s[p] - '0'), 1 << 20); digits++; p++; }
                if (!Ends(At(s, p), special)) return null;
                if (digits > 0 && port > 65535) return null;
                return host;
            }
            if (Ends(c, special))
            {
                if (special && buf.Length == 0) return null;
                return ParseHost(buf.ToString(), !special);
            }
            if (c == '[') brackets = true;
            if (c == ']') brackets = false;
            buf.Append((char)c);
        }
    }

    private static string? FileHost(string s, int p)
    {
        if (At(s, p) is not ('/' or '\\')) return "";
        p++;
        if (At(s, p) is not ('/' or '\\')) return "";
        p++;
        var start = p;
        while (!(At(s, p) is Eof or '/' or '\\' or '?' or '#')) p++;
        var buf = s[start..p];
        if (buf.Length == 2 && char.IsAsciiLetter(buf[0]) && buf[1] is ':' or '|') return "";   // a Windows drive letter
        if (buf.Length == 0) return "";
        var host = ParseHost(buf, false);
        return host == "localhost" ? "" : host;
    }

    private static bool ForbiddenHost(char c) =>
        c is '\0' or '\t' or '\n' or '\r' or ' ' or '#' or '/' or ':' or '<' or '>' or '?' or '@' or '[' or '\\' or ']' or '^' or '|';
    private static bool ForbiddenDomain(char c) => ForbiddenHost(c) || c <= 0x1F || c == '%' || c == 0x7F;

    /* The host parser, serialized as hostname gives it. */
    private static string? ParseHost(string input, bool opaque)
    {
        if (input.StartsWith('['))
        {
            if (!input.EndsWith(']') || input.Length < 2) return null;
            var v6 = ParseIPv6(input[1..^1]);
            return v6 == null ? null : "[" + v6 + "]";
        }
        if (opaque)
        {
            if (input.Any(ForbiddenHost)) return null;
            var o = new StringBuilder();
            Span<byte> bytes = stackalloc byte[4];
            foreach (var r in input.EnumerateRunes())
            {
                if (r.Value >= 0x20 && r.Value <= 0x7E) { o.Append((char)r.Value); continue; }
                var n = r.EncodeToUtf8(bytes);
                for (var i = 0; i < n; i++) o.Append('%').Append(bytes[i].ToString("X2", CultureInfo.InvariantCulture));
            }
            return o.ToString();
        }
        var domain = new UTF8Encoding(false, false).GetString(PercentDecode(input));
        var ascii = DomainToAscii(domain);
        if (ascii == null) return null;
        return EndsInNumber(ascii) ? ParseIPv4(ascii) : ascii;
    }

    private static byte[] PercentDecode(string input)
    {
        var bytes = Encoding.UTF8.GetBytes(input);
        var o = new List<byte>(bytes.Length);
        for (var i = 0; i < bytes.Length; i++)
        {
            if (bytes[i] == '%' && i + 2 < bytes.Length && char.IsAsciiHexDigit((char)bytes[i + 1]) && char.IsAsciiHexDigit((char)bytes[i + 2]))
            {
                o.Add(Convert.ToByte(Encoding.ASCII.GetString(bytes, i + 1, 2), 16));
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
                l = l.ToLowerInvariant();
                if (l.StartsWith("xn--", StringComparison.Ordinal) && !PunycodeOk(l[4..])) return null;
                labels[i] = l;
                continue;
            }
            try { labels[i] = Idn.GetAscii(l).ToLowerInvariant(); }
            catch (ArgumentException) { return null; }
        }
        var result = string.Join(".", labels);
        if (result.Length == 0 || result.Any(ForbiddenDomain)) return null;
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

    private static bool EndsInNumber(string s)
    {
        var parts = s.Split('.').ToList();
        if (parts[^1].Length == 0)
        {
            if (parts.Count == 1) return false;
            parts.RemoveAt(parts.Count - 1);
        }
        var last = parts[^1];
        if (last.Length > 0 && last.All(char.IsAsciiDigit)) return true;
        return IPv4Number(last) != null;
    }

    /* An IPv4 part: decimal, 0x hex or 0-led octal; capped (anything that large is out of range anyway). */
    private static double? IPv4Number(string s)
    {
        if (s.Length == 0) return null;
        var radix = 10;
        if (s.Length >= 2 && s[0] == '0' && s[1] is 'x' or 'X') { s = s[2..]; radix = 16; }
        else if (s.Length >= 2 && s[0] == '0') { s = s[1..]; radix = 8; }
        if (s.Length == 0) return 0;
        double v = 0;
        foreach (var c in s)
        {
            var d = c >= '0' && c <= '9' ? c - '0' : (c | 0x20) >= 'a' && (c | 0x20) <= 'f' ? (c | 0x20) - 'a' + 10 : 99;
            if (d >= radix) return null;
            v = Math.Min(v * radix + d, 1e15);
        }
        return v;
    }

    private static string? ParseIPv4(string s)
    {
        var parts = s.Split('.').ToList();
        if (parts[^1].Length == 0 && parts.Count > 1) parts.RemoveAt(parts.Count - 1);
        if (parts.Count > 4) return null;
        var numbers = new List<double>();
        foreach (var part in parts)
        {
            if (IPv4Number(part) is not { } v) return null;
            numbers.Add(v);
        }
        for (var i = 0; i < numbers.Count - 1; i++) if (numbers[i] > 255) return null;
        if (numbers[^1] >= Math.Pow(256, 5 - numbers.Count)) return null;
        var ipv4 = numbers[^1];
        for (var i = 0; i < numbers.Count - 1; i++) ipv4 += numbers[i] * Math.Pow(256, 3 - i);
        var x = (uint)ipv4;
        return $"{x >> 24}.{(x >> 16) & 255}.{(x >> 8) & 255}.{x & 255}";
    }

    private static string? ParseIPv6(string s)
    {
        var address = new int[8];
        int piece = 0, p = 0;
        int? compress = null;
        int C(int i) => i < s.Length ? s[i] : Eof;
        if (C(p) == ':')
        {
            if (C(p + 1) != ':') return null;
            p += 2;
            piece++;
            compress = piece;
        }
        while (C(p) != Eof)
        {
            if (piece == 8) return null;
            if (C(p) == ':')
            {
                if (compress != null) return null;
                p++;
                piece++;
                compress = piece;
                continue;
            }
            int value = 0, length = 0;
            while (length < 4 && C(p) != Eof && char.IsAsciiHexDigit((char)C(p))) { value = value * 16 + Convert.ToInt32(((char)C(p)).ToString(), 16); p++; length++; }
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
                    if (C(p) == Eof || !char.IsAsciiDigit((char)C(p))) return null;
                    while (C(p) != Eof && char.IsAsciiDigit((char)C(p)))
                    {
                        var number = C(p) - '0';
                        if (v4 == null) v4 = number;
                        else if (v4 == 0) return null;
                        else v4 = v4 * 10 + number;
                        if (v4 > 255) return null;
                        p++;
                    }
                    address[piece] = address[piece] * 0x100 + v4!.Value;
                    seen++;
                    if (seen is 2 or 4) piece++;
                }
                if (seen != 4) return null;
                break;
            }
            if (C(p) == ':')
            {
                p++;
                if (C(p) == Eof) return null;
            }
            else if (C(p) != Eof) return null;
            address[piece] = value;
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

        // Serialized: the first longest run of two or more zero pieces as "::".
        int? run = null;
        int best = 1;
        for (var i = 0; i < 8;)
        {
            if (address[i] != 0) { i++; continue; }
            var j = i;
            while (j < 8 && address[j] == 0) j++;
            if (j - i > best) { best = j - i; run = i; }
            i = j;
        }
        var o = new StringBuilder();
        var ignore0 = false;
        for (var i = 0; i < 8; i++)
        {
            if (ignore0 && address[i] == 0) continue;
            ignore0 = false;
            if (run == i)
            {
                o.Append(i == 0 ? "::" : ":");
                ignore0 = true;
                continue;
            }
            o.Append(address[i].ToString("x", CultureInfo.InvariantCulture));
            if (i != 7) o.Append(':');
        }
        return o.ToString();
    }
}
