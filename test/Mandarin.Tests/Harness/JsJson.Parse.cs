using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

public static partial class JsJson
{
    /// <summary>
    /// JSON read as JavaScript's JSON.parse reads it: a string may hold a lone surrogate (System.Text.Json
    /// refuses one), nesting has no limit, every number is a double, and an object's array-index keys come
    /// first, ascending, as a JavaScript object keeps them.
    /// </summary>
    public static JsonNode? Parse(string text)
    {
        int i = 0;
        var v = Value(text, ref i);
        Space(text, ref i);
        if (i != text.Length) throw new FormatException("JSON with more after it at " + i);
        return v;
    }

    private static void Space(string s, ref int i) { while (i < s.Length && s[i] is ' ' or '\t' or '\n' or '\r') i++; }

    private static JsonNode? Value(string s, ref int i)
    {
        Space(s, ref i);
        if (i >= s.Length) throw new FormatException("JSON ends early");
        switch (s[i])
        {
            case '{':
                {
                    i++;
                    var o = new JsonObject();
                    Space(s, ref i);
                    if (s[i] == '}') { i++; return o; }
                    for (; ; )
                    {
                        Space(s, ref i);
                        var k = Text(s, ref i);
                        Space(s, ref i);
                        Expect(s, ref i, ':');
                        o[k] = Value(s, ref i);
                        Space(s, ref i);
                        if (s[i] == ',') { i++; continue; }
                        Expect(s, ref i, '}');
                        return o.Any(kv => IsIndex(kv.Key)) ? Ordered(o) : o;
                    }
                }
            case '[':
                {
                    i++;
                    var a = new JsonArray();
                    Space(s, ref i);
                    if (s[i] == ']') { i++; return a; }
                    for (; ; )
                    {
                        a.Add(Value(s, ref i));
                        Space(s, ref i);
                        if (s[i] == ',') { i++; continue; }
                        Expect(s, ref i, ']');
                        return a;
                    }
                }
            case '"': return JsonValue.Create(Text(s, ref i));
            case 't': Word(s, ref i, "true"); return JsonValue.Create(true);
            case 'f': Word(s, ref i, "false"); return JsonValue.Create(false);
            case 'n': Word(s, ref i, "null"); return null;
            default:
                {
                    int from = i;
                    while (i < s.Length && (char.IsAsciiDigit(s[i]) || s[i] is '-' or '+' or '.' or 'e' or 'E')) i++;
                    if (i == from) throw new FormatException("JSON: a value expected at " + i);
                    return JsonValue.Create(double.Parse(s.AsSpan(from, i - from), NumberStyles.Float, CultureInfo.InvariantCulture));
                }
        }
    }

    private static void Expect(string s, ref int i, char c)
    {
        if (i >= s.Length || s[i] != c) throw new FormatException($"JSON: '{c}' expected at {i}");
        i++;
    }

    private static void Word(string s, ref int i, string w)
    {
        if (string.CompareOrdinal(s, i, w, 0, w.Length) != 0) throw new FormatException("JSON: " + w + " expected at " + i);
        i += w.Length;
    }

    private static string Text(string s, ref int i)
    {
        Expect(s, ref i, '"');
        var sb = new StringBuilder();
        for (; ; )
        {
            char c = s[i++];
            if (c == '"') return sb.ToString();
            if (c != '\\') { sb.Append(c); continue; }
            char e = s[i++];
            switch (e)
            {
                case 'b': sb.Append('\b'); break;
                case 'f': sb.Append('\f'); break;
                case 'n': sb.Append('\n'); break;
                case 'r': sb.Append('\r'); break;
                case 't': sb.Append('\t'); break;
                case 'u': sb.Append((char)int.Parse(s.AsSpan(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture)); i += 4; break;
                default: sb.Append(e); break;
            }
        }
    }

    /// <summary>
    /// Equal as assert.deepStrictEqual has two values read from JSON: objects whatever their keys' order,
    /// arrays in order, numbers by value, strings unit for unit (a lone surrogate too).
    /// </summary>
    public static bool DeepEqual(JsonNode? a, JsonNode? b)
    {
        switch (a, b)
        {
            case (null, null): return true;
            case (JsonObject x, JsonObject y):
                return x.Count == y.Count && x.All(kv => y.TryGetPropertyValue(kv.Key, out var w) && DeepEqual(kv.Value, w));
            case (JsonArray x, JsonArray y):
                return x.Count == y.Count && x.Select((v, i) => DeepEqual(v, y[i])).All(t => t);
            case (JsonValue, JsonValue): return Stringify(a) == Stringify(b);
            default: return false;
        }
    }
}
