// Prop.cs — reading a property of a JavaScript value as JavaScript reads it
// (v0.8.37), for the renderers' ports: what lib/xml.js gives back, or a
// register row, can be an object, a list or a string where the Node code
// expects an object, and the Node code reads on regardless.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

using Js = Mandarin.Server.Tags.Js;

internal static class Prop
{
    /* v[key]: an object's own, a list's or a string's index or length, undefined on anything else; null and undefined throw. */
    public static object? Get(object? v, string key) => v switch
    {
        JsObj o => o[key],
        List<object?> l => key == "length" ? (object?)(double)l.Count : Js.IsIndex(key, out var i) && i < l.Count ? l[(int)i] : Undef.V,
        string s => key == "length" ? (object?)(double)s.Length : Js.IsIndex(key, out var i) && i < s.Length ? s[(int)i].ToString() : Undef.V,
        null or Undef => throw new JsError($"Cannot read properties of {Js.Str(v)} (reading '{key}')"),
        _ => Undef.V
    };

    /* Object.entries(v): an object's keys in JavaScript's order; a list's or a string's indices. */
    public static IEnumerable<(string Key, object? Value)> Entries(object? v)
    {
        switch (v)
        {
            case JsObj o:
                foreach (var k in o.Keys) yield return (k, o[k]);
                break;
            case List<object?> l:
                for (var i = 0; i < l.Count; i++) yield return (i.ToString(System.Globalization.CultureInfo.InvariantCulture), l[i]);
                break;
            case string s:
                for (var i = 0; i < s.Length; i++) yield return (i.ToString(System.Globalization.CultureInfo.InvariantCulture), s[i].ToString());
                break;
            case null or Undef:
                throw new JsError("Cannot convert undefined or null to object");
        }
    }

    /* a || b */
    public static object? Or(object? a, object? b) => Js.Truthy(a) ? a : b;

    /* ASCII letters compared without case, as a JavaScript /i pattern without /u compares them. */
    public static bool AsciiAt(string s, int at, string word)
    {
        if (at < 0 || at + word.Length > s.Length) return false;
        for (var k = 0; k < word.Length; k++)
        {
            char a = s[at + k], b = word[k];
            if (a == b) continue;
            if (a is >= 'A' and <= 'Z') a = (char)(a | 0x20);
            if (b is >= 'A' and <= 'Z') b = (char)(b | 0x20);
            if (a != b || a is < 'a' or > 'z') return false;
        }
        return true;
    }

    /* /word/i.test(s) */
    public static bool AsciiContains(string s, string word)
    {
        for (var i = 0; i + word.Length <= s.Length; i++) if (AsciiAt(s, i, word)) return true;
        return false;
    }
}
