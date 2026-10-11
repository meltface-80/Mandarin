// Signing.cs — the addresses handed to speakers (v0.8.38), from
// lib/server/auth.js (sig, signUrl, and the gate's check of a stream's or a
// cover's address), rule for rule.
//
// A Sonos speaker can't sign in, so the address it is given carries its proof:
// ?s= (or &s=), the first 22 characters of the HMAC-SHA256 of the address's
// path under the install's secret (the authSecret setting), in base64url. The
// path is the address as written, up to its query, percent escapes and all;
// the signature never expires, and covers the path only, so the query can
// change (a size, a gain) and the signature still holds.
//
// The check reads the address as the Node server reads it: its path as the
// request gives it (parseurl's, not decoded), and `s` as Express's query
// parser (qs) makes it. A plain `s=` is decided here, as there; where qs would
// make an array or an object of `s` (s[]=, s[0]=, [s]=…), or the address isn't
// a plain path, this side doesn't vouch (null) and the request is the Node
// server's to decide. Images.cs and Streams.cs check with this.
using System.Security.Cryptography;
using System.Text;

namespace Mandarin.Server.Playback;

internal static class Signing
{
    /* sig(p) */
    public static string Sig(string secret, string path)
    {
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(path));
        return Convert.ToBase64String(mac).TrimEnd('=').Replace('+', '-').Replace('/', '_')[..22];
    }

    /* signUrl(url): the path (after the host, before the query) signed, ?s= or &s= added. */
    public static string SignUrl(string secret, string url)
    {
        var i = url.IndexOf("://", StringComparison.Ordinal);
        var start = i >= 0 ? url.IndexOf('/', i + 3) : 0;
        if (start < 0) start = Math.Max(0, url.Length - 1);   // slice(-1): the last character, as there
        var rest = url[start..];
        var q = rest.IndexOf('?');
        var pathOnly = q >= 0 ? rest[..q] : rest;
        return url + (url.Contains('?') ? "&" : "?") + "s=" + Sig(secret, pathOnly);
    }

    private static bool SigChar(char c) => char.IsAsciiLetterOrDigit(c) || c is '_' or '-';

    /* The gate's test: s is 22 base64url characters and the path's signature. */
    public static bool Valid(string secret, string path, string s)
    {
        if (s.Length != 22 || !s.All(SigChar)) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(s), Encoding.ASCII.GetBytes(Sig(secret, path)));
    }

    /*
     * parseurl's path and query of a request target, where it reads them
     * directly (a target starting with "/" with no tab, line break, form feed,
     * space, #, no-break space or BOM in it): before and after the first "?".
     * null otherwise (Node's url.parse reads those).
     */
    public static (string Path, string? Query)? Target(string? raw)
    {
        if (string.IsNullOrEmpty(raw) || raw[0] != '/') return null;
        for (var i = 1; i < raw.Length; i++)
            if (raw[i] is '\t' or '\n' or '\f' or '\r' or ' ' or '#' or ' ' or '﻿') return null;
        var q = raw.IndexOf('?');
        return q >= 0 ? (raw[..q], raw[(q + 1)..]) : (raw, null);
    }

    /*
     * String(req.query.s || "") as Express's query parser (qs, with the
     * options Express gives it) makes it, for a query where `s` is plain: the
     * value, or the values joined by commas, or "". null where a key would
     * make `s` an array or an object.
     */
    public static string? QueryS(string? query)
    {
        if (string.IsNullOrEmpty(query)) return "";
        var clean = query.Replace("%5B", "[", StringComparison.OrdinalIgnoreCase).Replace("%5D", "]", StringComparison.OrdinalIgnoreCase);
        var parts = clean.Split('&');
        var values = new List<string>();
        for (var n = 0; n < parts.Length && n < 1000; n++)   // parameterLimit
        {
            var part = parts[n];
            var bracketEquals = part.IndexOf("]=", StringComparison.Ordinal);
            var pos = bracketEquals == -1 ? part.IndexOf('=') : bracketEquals + 1;
            var key = Decode(pos == -1 ? part : part[..pos]);
            if (key == "s") values.Add(pos == -1 ? "" : Decode(part[(pos + 1)..]));
            else if (key.StartsWith("s[", StringComparison.Ordinal) || key.StartsWith('[')) return null;
        }
        return string.Join(",", values);
    }

    /* qs's decode: + is a space, then decodeURIComponent, or the text as it is where that throws. */
    private static string Decode(string s)
    {
        var plus = s.Replace('+', ' ');
        return DecodeURIComponent(plus) ?? plus;
    }

    /* decodeURIComponent, or null where it throws (a malformed escape or UTF-8). */
    public static string? DecodeURIComponent(string s)
    {
        if (!s.Contains('%')) return s;
        var sb = new StringBuilder(s.Length);
        static int Hex(char c) => c >= '0' && c <= '9' ? c - '0' : (c | 0x20) >= 'a' && (c | 0x20) <= 'f' ? (c | 0x20) - 'a' + 10 : -1;
        int Byte(int at) => at + 2 < s.Length && s[at] == '%' && Hex(s[at + 1]) >= 0 && Hex(s[at + 2]) >= 0 ? Hex(s[at + 1]) * 16 + Hex(s[at + 2]) : -1;
        for (var i = 0; i < s.Length; i++)
        {
            if (s[i] != '%') { sb.Append(s[i]); continue; }
            var b = Byte(i);
            if (b < 0) return null;
            i += 2;
            if (b < 0x80) { sb.Append((char)b); continue; }
            int n, cp;
            if ((b & 0xE0) == 0xC0) { n = 2; cp = b & 0x1F; }
            else if ((b & 0xF0) == 0xE0) { n = 3; cp = b & 0x0F; }
            else if ((b & 0xF8) == 0xF0) { n = 4; cp = b & 0x07; }
            else return null;
            for (var k = 1; k < n; k++)
            {
                var c = Byte(i + 1);
                if (c < 0 || (c & 0xC0) != 0x80) return null;
                cp = (cp << 6) | (c & 0x3F);
                i += 3;
            }
            var min = n == 2 ? 0x80 : n == 3 ? 0x800 : 0x10000;
            if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return null;
            sb.Append(char.ConvertFromUtf32(cp));
        }
        return sb.ToString();
    }

    /*
     * The gate's decision on a stream's or a cover's address by its signature
     * (a speaker asking by its own address aside): true or false as the Node
     * server decides it, or null where this side doesn't vouch.
     */
    public static bool? Gate(string secret, string? rawTarget)
    {
        if (Target(rawTarget) is not { } t) return null;
        if (QueryS(t.Query) is not { } s) return null;
        return Valid(secret, t.Path, s);
    }
}
