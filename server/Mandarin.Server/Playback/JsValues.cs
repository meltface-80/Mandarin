// JsValues.cs — JavaScript values read the way the Node server's playback
// code reads them (v0.8.38), for the ports in this folder: a property of
// anything (undefined unless it is an object that has it), Number(), String(),
// truthiness, ===, Array.prototype.includes, path.extname, and the small
// regular expressions that code tests names with, spelled out: \b and /i are
// ASCII-only in JavaScript (without the u flag), and $ is the very end.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class Jv
{
    /* o.k: undefined unless o is an object that has k; a TypeError on null or undefined, as there. */
    public static object? Get(object? o, string k) => o switch
    {
        JsObj j => j[k],
        null or Undef => throw new JsError($"Cannot read properties of {Js.Str(o)} (reading '{k}')"),
        _ => Undef.V
    };

    /* Number(v) (an array is read through String(), as JavaScript does). */
    public static double Num(object? v) => v switch
    {
        List<object?> l => Js.StringToNumber(Js.Str(l)),
        JsObj => double.NaN,
        _ => Js.ToNumber(v)
    };

    public static bool T(object? v) => Js.Truthy(v);
    public static string Str(object? v) => Js.Str(v);

    /* a || b */
    public static object? Or(object? a, object? b) => T(a) ? a : b;
    public static double Or(double a, double b) => a == 0 || double.IsNaN(a) ? b : a;

    public static bool Nullish(object? v) => Js.IsNullish(v);

    /* a === b */
    public static bool Same(object? a, object? b) => Js.StrictEq(a, b);

    /* SameValueZero: === but NaN is itself (Array.prototype.includes, Set, Map). */
    public static bool SameZero(object? a, object? b) =>
        a is double x && b is double y ? x == y || (double.IsNaN(x) && double.IsNaN(y)) : Js.StrictEq(a, b);

    public static bool Includes(object? list, object? v) => list is List<object?> l && l.Exists(x => SameZero(x, v));

    /* [list].includes(v) for a list of strings. */
    public static bool OneOf(object? v, params string[] list) => v is string s && Array.IndexOf(list, s) >= 0;

    /* path.extname(p), which takes only a string. */
    public static string Extname(object? p) =>
        p is string s ? Scan.NodePath.Extname(s) : throw new JsError("The \"path\" argument must be of type string");

    /* Number.isFinite(v): a number, and finite. */
    public static bool IsFiniteNumber(object? v) => v is double d && double.IsFinite(d);

    // ---------------------------------------------------------------- tests on names

    private static char Fold(char c) => c is >= 'A' and <= 'Z' ? (char)(c + 32) : c;

    /* /suffix$/i, suffix given in lower case. */
    public static bool EndsCI(string s, string suffix)
    {
        if (s.Length < suffix.Length) return false;
        var at = s.Length - suffix.Length;
        for (var i = 0; i < suffix.Length; i++) if (Fold(s[at + i]) != suffix[i]) return false;
        return true;
    }

    /* /sub/i, sub given in lower case. */
    public static bool HasCI(string s, string sub)
    {
        for (var at = 0; at + sub.Length <= s.Length; at++)
        {
            var i = 0;
            while (i < sub.Length && Fold(s[at + i]) == sub[i]) i++;
            if (i == sub.Length) return true;
        }
        return false;
    }

    public static bool Has(string s, string sub) => s.Contains(sub, StringComparison.Ordinal);

    private static bool Word(char c) => char.IsAsciiLetterOrDigit(c) || c == '_';

    /* /\bword\b/ */
    public static bool HasWord(string s, string word)
    {
        for (var i = s.IndexOf(word, StringComparison.Ordinal); i >= 0; i = s.IndexOf(word, i + 1, StringComparison.Ordinal))
        {
            var before = i == 0 || !Word(s[i - 1]);
            var end = i + word.Length;
            if (before && (end == s.Length || !Word(s[end]))) return true;
        }
        return false;
    }

    /* A new object from pairs, in that order. */
    public static JsObj Obj(params (string Key, object? Value)[] pairs)
    {
        var o = new JsObj();
        foreach (var (k, v) in pairs) o[k] = v;
        return o;
    }

    /* Object.assign({}, o) without the keys named. */
    public static JsObj CopyWithout(JsObj o, string drop)
    {
        var c = new JsObj();
        foreach (var k in o.Keys) if (k != drop) c[k] = o[k];
        return c;
    }
}
