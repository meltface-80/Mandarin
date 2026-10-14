using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

public static partial class JsJson
{
    // An array index's name, as JavaScript orders an object's keys: 0 to 2^32 − 2, written without leading zeros.
    private static bool IsIndex(string k) =>
        k.Length > 0 && (k == "0" || k[0] != '0') && k.All(char.IsAsciiDigit) && ulong.TryParse(k, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n < 4294967295;

    /// <summary>
    /// <paramref name="v"/> with every object's keys in the order a JavaScript object keeps them: the
    /// array-index keys first, ascending, then the rest as they were added — as a value made in
    /// JavaScript, or sent through JSON.stringify, has them.
    /// </summary>
    public static JsonNode? Ordered(JsonNode? v)
    {
        switch (v)
        {
            case JsonObject o:
                {
                    var keys = o.Select(kv => kv.Key).ToList();
                    var index = keys.Where(IsIndex).OrderBy(k => ulong.Parse(k, CultureInfo.InvariantCulture));
                    var r = new JsonObject();
                    foreach (var k in index.Concat(keys.Where(k => !IsIndex(k)))) r[k] = Ordered(o[k]);
                    return r;
                }
            case JsonArray a: return new JsonArray([.. a.Select(Ordered)]);
            default: return v?.DeepClone();
        }
    }

    /// <summary>JSON.stringify(<paramref name="v"/>, null, <paramref name="indent"/>): a −0 as "0".</summary>
    public static string Pretty(JsonNode? v, int indent = 1)
    {
        var sb = new StringBuilder();
        Pretty(sb, v, indent, 0);
        return sb.ToString();
    }

    private static void Pretty(StringBuilder sb, JsonNode? v, int indent, int depth)
    {
        string Pad(int d) => "\n" + new string(' ', indent * d);
        switch (v)
        {
            case JsonObject o when o.Count > 0:
                sb.Append('{');
                bool first = true;
                foreach (var (k, x) in o)
                {
                    sb.Append(first ? "" : ",").Append(Pad(depth + 1));
                    first = false;
                    Str(sb, k);
                    sb.Append(": ");
                    Pretty(sb, x, indent, depth + 1);
                }
                sb.Append(Pad(depth)).Append('}');
                break;
            case JsonArray a when a.Count > 0:
                sb.Append('[');
                for (int i = 0; i < a.Count; i++)
                {
                    sb.Append(i > 0 ? "," : "").Append(Pad(depth + 1));
                    Pretty(sb, a[i], indent, depth + 1);
                }
                sb.Append(Pad(depth)).Append(']');
                break;
            default: sb.Append(Stringify(v, markNegativeZero: false)); break;
        }
    }
}
