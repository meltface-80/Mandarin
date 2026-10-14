using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// JSON written exactly as JavaScript's JSON.stringify writes it (no spaces; a number as Number's
/// toString writes it; only quote, backslash and control characters escaped), with a −0 told from a 0
/// as the recordings did (test/golden). The recordings' sums are of this text, byte for byte.
/// </summary>
public static partial class JsJson
{
    /// <summary>
    /// The text JSON.stringify gives for <paramref name="v"/>: a −0 written as the string "\u0000-0", as the
    /// recordings' replacer wrote it, unless <paramref name="markNegativeZero"/> is false (then "0", as a
    /// job sent to the program was written).
    /// </summary>
    public static string Stringify(JsonNode? v, bool markNegativeZero = true)
    {
        var sb = new StringBuilder();
        Write(sb, v, markNegativeZero);
        return sb.ToString();
    }

    private static void Write(StringBuilder sb, JsonNode? v, bool mark)
    {
        switch (v)
        {
            case null: sb.Append("null"); break;
            case JsonObject o:
                sb.Append('{');
                bool first = true;
                foreach (var (k, x) in o)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Str(sb, k);
                    sb.Append(':');
                    Write(sb, x, mark);
                }
                sb.Append('}');
                break;
            case JsonArray a:
                sb.Append('[');
                for (int i = 0; i < a.Count; i++) { if (i > 0) sb.Append(','); Write(sb, a[i], mark); }
                sb.Append(']');
                break;
            case JsonValue j:
                var e = j.GetValueKind();
                if (e == JsonValueKind.String) Str(sb, j.GetValue<string>());
                else if (e == JsonValueKind.True) sb.Append("true");
                else if (e == JsonValueKind.False) sb.Append("false");
                else if (e == JsonValueKind.Number)
                {
                    var d = j.TryGetValue<double>(out var dd) ? dd : Convert.ToDouble(j.ToJsonString(), CultureInfo.InvariantCulture);
                    if (d == 0 && double.IsNegative(d) && mark) Str(sb, "\u0000-0");
                    else sb.Append(Number(d));
                }
                else sb.Append("null");
                break;
        }
    }

    // A string as JSON.stringify quotes it: well-formed JSON.stringify (lone surrogates escaped).
    private static void Str(StringBuilder sb, string s)
    {
        sb.Append('"');
        for (int i = 0; i < s.Length; i++)
        {
            char c = s[i];
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
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { sb.Append(c).Append(s[i + 1]); i++; }
                    else if (char.IsSurrogate(c)) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }

    /// <summary>
    /// A value written as a JavaScript literal would make it: a string, number, bool or null as itself, an
    /// array of them as an array, a JsonNode as it is, anything else as System.Text.Json writes it. (A
    /// string may hold a lone surrogate, as a JavaScript string may.)
    /// </summary>
    public static JsonNode? Of(object? v) => v switch
    {
        null => null,
        JsonNode n => n.DeepClone(),
        string s => JsonValue.Create(s),
        bool b => JsonValue.Create(b),
        int i => JsonValue.Create(i),
        long l => JsonValue.Create(l),
        double d => JsonValue.Create(d),
        System.Collections.IEnumerable e => new JsonArray([.. e.Cast<object?>().Select(Of)]),
        _ => JsonNode.Parse(JsonSerializer.Serialize(v))
    };

    /// <summary>A number as JavaScript's Number.prototype.toString writes it (ECMA-262 Number::toString).</summary>
    public static string Number(double d)
    {
        if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
        if (d == 0) return "0";
        var neg = d < 0;
        // The shortest digits that read back as d, and where the point goes.
        var shortest = Math.Abs(d).ToString("R", CultureInfo.InvariantCulture);
        string digits;
        int exp;
        int ePos = shortest.IndexOfAny(['E', 'e']);
        var mant = ePos >= 0 ? shortest[..ePos] : shortest;
        int e10 = ePos >= 0 ? int.Parse(shortest[(ePos + 1)..], CultureInfo.InvariantCulture) : 0;
        int dot = mant.IndexOf('.');
        var intPart = dot >= 0 ? mant[..dot] : mant;
        var frac = dot >= 0 ? mant[(dot + 1)..] : "";
        digits = (intPart + frac).TrimStart('0');
        int lead = (intPart + frac).Length - (intPart + frac).TrimStart('0').Length;
        // n: the position of the point after the first digit's place (ECMA's n).
        exp = intPart.Length + e10 - lead;
        digits = digits.TrimEnd('0');
        if (digits.Length == 0) return "0";
        int k = digits.Length, n = exp;
        var sb = new StringBuilder();
        if (neg) sb.Append('-');
        if (k <= n && n <= 21) sb.Append(digits).Append('0', n - k);
        else if (0 < n && n <= 21) sb.Append(digits, 0, n).Append('.').Append(digits, n, k - n);
        else if (-6 < n && n <= 0) sb.Append("0.").Append('0', -n).Append(digits);
        else
        {
            sb.Append(digits[0]);
            if (k > 1) sb.Append('.').Append(digits, 1, k - 1);
            sb.Append('e').Append(n - 1 >= 0 ? "+" : "-").Append(Math.Abs(n - 1).ToString(CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }
}
