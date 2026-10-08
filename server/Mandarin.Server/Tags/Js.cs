// Js.cs — JavaScript's own rules, for the tag reader (v0.8.13).
//
// The tag reader here is a port of music-metadata 11.16.0 as the scanner uses
// it (lib/library/scanner.js, readTags). What it reads goes into the library
// exactly as the Node reader's did, so the values keep JavaScript's shapes and
// conversions: undefined beside null, numbers as doubles printed the way
// String(n) prints them, String(), parseInt, parseFloat, Math.round, trim,
// toUpperCase, truthiness, and JSON.stringify with JavaScript's key order.
using System.Globalization;
using System.Numerics;
using System.Text;

namespace Mandarin.Server.Tags;

/* JavaScript's undefined (null is C#'s null). */
internal sealed class Undef
{
    public static readonly Undef V = new();
    private Undef() { }
    public override string ToString() => "undefined";
}

/* A Map: JSON.stringify writes it as {}. */
internal sealed class JsMap
{
    public readonly List<(string Key, object? Value)> Items = [];
    public object? Get(string k) { foreach (var (key, v) in Items) if (key == k) return v; return Undef.V; }
    public void Set(string k, object? v)
    {
        for (var i = 0; i < Items.Count; i++) if (Items[i].Key == k) { Items[i] = (k, v); return; }
        Items.Add((k, v));
    }
}

/* A plain object: its keys in JavaScript's order (integer keys first, ascending; the rest as added). */
internal sealed class JsObj
{
    private readonly Dictionary<string, object?> map = new(StringComparer.Ordinal);
    private readonly List<string> order = [];
    public object? this[string k]
    {
        get => map.TryGetValue(k, out var v) ? v : Undef.V;
        set { if (!map.ContainsKey(k)) order.Add(k); map[k] = value; }
    }
    public bool Has(string k) => map.ContainsKey(k);
    public int Count => map.Count;
    public IEnumerable<string> Keys
    {
        get
        {
            var ints = new List<(uint N, string K)>();
            foreach (var k in order) if (Js.IsIndex(k, out var n)) ints.Add((n, k));
            ints.Sort((a, b) => a.N.CompareTo(b.N));
            foreach (var (_, k) in ints) yield return k;
            foreach (var k in order) if (!Js.IsIndex(k, out _)) yield return k;
        }
    }
}

internal class JsError(string message) : Exception(message);

internal static class Js
{
    public static bool IsUndef(object? v) => v is Undef;
    public static bool IsNullish(object? v) => v is null or Undef;

    /* An array index ("0", "17"; not "01", not 2^32-1): sorted first among an object's keys. */
    public static bool IsIndex(string k, out uint n)
    {
        n = 0;
        if (k.Length == 0 || k.Length > 10) return false;
        if (k.Length > 1 && k[0] == '0') return false;
        foreach (var c in k) if (c < '0' || c > '9') return false;
        if (!ulong.TryParse(k, NumberStyles.None, CultureInfo.InvariantCulture, out var u) || u >= 4294967295UL) return false;
        n = (uint)u;
        return true;
    }

    public static bool Truthy(object? v) => v switch
    {
        null or Undef => false,
        bool b => b,
        double d => !(d == 0 || double.IsNaN(d)),
        string s => s.Length > 0,
        BigInteger b => !b.IsZero,
        _ => true
    };

    /* typeof v === 'object' (null aside). */
    public static bool IsObject(object? v) => v is JsObj or U8 or List<object?> or JsMap;

    /* String(v). */
    public static string Str(object? v) => v switch
    {
        null => "null",
        Undef => "undefined",
        string s => s,
        bool b => b ? "true" : "false",
        double d => Num(d),
        BigInteger b => b.ToString(CultureInfo.InvariantCulture),
        U8 u => Join(u),
        List<object?> l => string.Join(",", l.Select(x => IsNullish(x) ? "" : Str(x))),
        _ => "[object Object]"
    };

    private static string Join(U8 u)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < u.Length; i++) { if (i > 0) sb.Append(','); sb.Append(u.At(i)); }
        return sb.ToString();
    }

    /* Number(v). */
    public static double ToNumber(object? v) => v switch
    {
        null => 0,
        Undef => double.NaN,
        bool b => b ? 1 : 0,
        double d => d,
        string s => StringToNumber(s),
        BigInteger b => (double)b,
        List<object?> l => l.Count == 0 ? 0 : l.Count == 1 ? ToNumber(Str(l[0])) : double.NaN,
        _ => double.NaN
    };

    public static double StringToNumber(string s)
    {
        s = Trim(s);
        if (s.Length == 0) return 0;
        if (s.Length > 2 && s[0] == '0' && (s[1] | 0x20) is 'x' or 'o' or 'b')
        {
            var radix = (s[1] | 0x20) == 'x' ? 16 : (s[1] | 0x20) == 'o' ? 8 : 2;
            double r = 0;
            for (var i = 2; i < s.Length; i++)
            {
                var d = Digit(s[i]);
                if (d < 0 || d >= radix) return double.NaN;
                r = r * radix + d;
            }
            return r;
        }
        var n = ScanDecimal(s, 0, out var end, out var value);
        return n && end == s.Length ? value : double.NaN;
    }

    private static int Digit(char c) => c >= '0' && c <= '9' ? c - '0' : (c | 0x20) >= 'a' && (c | 0x20) <= 'z' ? (c | 0x20) - 'a' + 10 : -1;

    /* A StrDecimalLiteral at s[i..]: the longest one there, as parseFloat reads it. */
    private static bool ScanDecimal(string s, int i, out int end, out double value)
    {
        end = i; value = double.NaN;
        var p = i;
        var neg = false;
        if (p < s.Length && (s[p] == '+' || s[p] == '-')) { neg = s[p] == '-'; p++; }
        if (string.CompareOrdinal(s, p, "Infinity", 0, 8) == 0)
        {
            end = p + 8; value = neg ? double.NegativeInfinity : double.PositiveInfinity;
            return true;
        }
        var intStart = p;
        while (p < s.Length && s[p] >= '0' && s[p] <= '9') p++;
        var intDigits = s[intStart..p];
        var frac = "";
        if (p < s.Length && s[p] == '.')
        {
            var q = p + 1;
            while (q < s.Length && s[q] >= '0' && s[q] <= '9') q++;
            frac = s[(p + 1)..q];
            if (intDigits.Length > 0 || frac.Length > 0) p = q;
        }
        if (intDigits.Length == 0 && frac.Length == 0) return false;
        var exp = "";
        if (p < s.Length && (s[p] == 'e' || s[p] == 'E'))
        {
            var q = p + 1;
            var sign = "";
            if (q < s.Length && (s[q] == '+' || s[q] == '-')) { sign = s[q].ToString(); q++; }
            var es = q;
            while (q < s.Length && s[q] >= '0' && s[q] <= '9') q++;
            if (q > es) { exp = "e" + sign + s[es..q]; p = q; }
        }
        var text = (intDigits.Length > 0 ? intDigits : "0") + (frac.Length > 0 ? "." + frac : "") + exp;
        value = double.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture);
        if (neg) value = -value;
        end = p;
        return true;
    }

    /* parseFloat(String(v)). */
    public static double ParseFloat(object? v)
    {
        var s = Str(v);
        var i = 0;
        while (i < s.Length && IsWs(s[i])) i++;
        return ScanDecimal(s, i, out _, out var value) ? value : double.NaN;
    }

    /* parseInt(String(v), 10). */
    public static double ParseInt(object? v)
    {
        var s = Str(v);
        var i = 0;
        while (i < s.Length && IsWs(s[i])) i++;
        var neg = false;
        if (i < s.Length && (s[i] == '+' || s[i] == '-')) { neg = s[i] == '-'; i++; }
        var start = i;
        while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;
        if (i == start) return double.NaN;
        var r = double.Parse(s[start..i], NumberStyles.None, CultureInfo.InvariantCulture);
        return neg ? -r : r;
    }

    /* Math.round: halves go up. */
    public static double Round(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x) || x == 0) return x;
        var r = Math.Floor(x);
        if (x - r >= 0.5) r += 1;
        if (r == 0 && x < 0) return -0.0;
        return r;
    }

    /* String(n) for a number: the shortest digits that read back, placed as JavaScript places them. */
    public static string Num(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (d == 0) return "0";
        if (double.IsInfinity(d)) return d > 0 ? "Infinity" : "-Infinity";
        var r = d.ToString("R", CultureInfo.InvariantCulture);
        var neg = r[0] == '-';
        if (neg) r = r[1..];
        var exp = 0;
        var e = r.IndexOf('E');
        var mant = r;
        if (e >= 0) { exp = int.Parse(r[(e + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture); mant = r[..e]; }
        var dot = mant.IndexOf('.');
        string digits;
        int point;
        if (dot >= 0) { digits = mant[..dot] + mant[(dot + 1)..]; point = dot; }
        else { digits = mant; point = mant.Length; }
        var lz = 0;
        while (lz < digits.Length - 1 && digits[lz] == '0') { lz++; point--; }
        digits = digits[lz..].TrimEnd('0');
        if (digits.Length == 0) return "0";
        var n = point + exp;
        var k = digits.Length;
        var sb = new StringBuilder();
        if (neg) sb.Append('-');
        if (k <= n && n <= 21) { sb.Append(digits).Append('0', n - k); }
        else if (0 < n && n <= 21) { sb.Append(digits, 0, n).Append('.').Append(digits, n, k - n); }
        else if (-6 < n && n <= 0) { sb.Append("0.").Append('0', -n).Append(digits); }
        else
        {
            var e1 = n - 1;
            sb.Append(digits[0]);
            if (k > 1) sb.Append('.').Append(digits, 1, k - 1);
            sb.Append('e').Append(e1 < 0 ? '-' : '+').Append(Math.Abs(e1).ToString(CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }

    /* JavaScript's white space and line terminators (trim, \s, parseInt's leading space). */
    public static bool IsWs(char c) => c switch
    {
        (char)0x09 or (char)0x0A or (char)0x0B or (char)0x0C or (char)0x0D or (char)0x20 or (char)0xA0 or (char)0x1680
            or (char)0x2028 or (char)0x2029 or (char)0x202F or (char)0x205F or (char)0x3000 or (char)0xFEFF => true,
        _ => c >= (char)0x2000 && c <= (char)0x200A
    };

    public static string Trim(string s)
    {
        int a = 0, b = s.Length;
        while (a < b && IsWs(s[a])) a++;
        while (b > a && IsWs(s[b - 1])) b--;
        return a == 0 && b == s.Length ? s : s[a..b];
    }

    /* toUpperCase / toLowerCase: Unicode's full mappings, as JavaScript makes them (Case.cs). */
    public static string Upper(string s) => Case.Upper(s);
    public static string Lower(string s) => Case.Lower(s);

    /* a === b, for the values a tag can hold. */
    public static bool StrictEq(object? a, object? b) => (a, b) switch
    {
        (null, null) => true,
        (Undef, Undef) => true,
        (string x, string y) => string.Equals(x, y, StringComparison.Ordinal),
        (double x, double y) => x == y,
        (bool x, bool y) => x == y,
        (BigInteger x, BigInteger y) => x == y,
        _ => a is not null && ReferenceEquals(a, b)
    };

    /* list.indexOf(v) !== -1 */
    public static bool Contains(List<object?> list, object? v)
    {
        foreach (var x in list) if (StrictEq(x, v)) return true;
        return false;
    }

    /* JSON.stringify(v); null where it gives undefined. */
    public static string? Json(object? v)
    {
        var sb = new StringBuilder();
        return WriteJson(sb, v) ? sb.ToString() : null;
    }

    private static bool WriteJson(StringBuilder sb, object? v)
    {
        switch (v)
        {
            case Undef: return false;
            case null: sb.Append("null"); return true;
            case bool b: sb.Append(b ? "true" : "false"); return true;
            case double d: sb.Append(double.IsFinite(d) ? Num(d) : "null"); return true;
            case string s: Quote(sb, s); return true;
            case BigInteger: throw new JsError("Do not know how to serialize a BigInt");
            case U8 u:
                sb.Append('{');
                for (var i = 0; i < u.Length; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append('"').Append(i).Append("\":").Append(u.At(i));
                }
                sb.Append('}');
                return true;
            case JsMap: sb.Append("{}"); return true;
            case List<object?> l:
                sb.Append('[');
                for (var i = 0; i < l.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    if (!WriteJson(sb, l[i])) sb.Append("null");
                }
                sb.Append(']');
                return true;
            case JsObj o:
                sb.Append('{');
                var first = true;
                foreach (var k in o.Keys)
                {
                    var x = o[k];
                    if (x is Undef) continue;
                    var mark = sb.Length;
                    if (!first) sb.Append(',');
                    Quote(sb, k);
                    sb.Append(':');
                    if (!WriteJson(sb, x)) { sb.Length = mark; continue; }
                    first = false;
                }
                sb.Append('}');
                return true;
            default: return false;
        }
    }

    public static void Quote(StringBuilder sb, string s)
    {
        sb.Append('"');
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) { sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture)); break; }
                    if (char.IsHighSurrogate(c))
                    {
                        if (i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { sb.Append(c).Append(s[i + 1]); i++; }
                        else sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        break;
                    }
                    if (char.IsLowSurrogate(c)) { sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture)); break; }
                    sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }
}
