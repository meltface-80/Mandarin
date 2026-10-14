using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// What the parity suites' JavaScript made its cases with, in C#, value for value: the seeded
/// generator (mulberry32), JavaScript's undefined (a key left out of an object, a null in an array, as
/// JSON.stringify writes them), and objects built key by key in the order JavaScript keeps.
/// </summary>
public static class JsGen
{
    /// <summary>JavaScript's undefined.</summary>
    public static readonly object Undefined = new();

    /// <summary>The suites' rng(seed): a number in [0, 1) each call.</summary>
    public static Func<double> Rng(uint seed)
    {
        uint a = seed;
        return () =>
        {
            unchecked
            {
                a += 0x6D2B79F5;
                uint t = a;
                t = (t ^ (t >> 15)) * (t | 1);
                t ^= t + (t ^ (t >> 7)) * (t | 61);
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        };
    }

    /// <summary>Math.floor(r() * n).</summary>
    public static int Floor(double x) => (int)Math.Floor(x);

    /// <summary>A value as JSON.stringify writes it in an array (undefined: null).</summary>
    public static JsonNode? Node(object? v) => v switch
    {
        null => null,
        _ when ReferenceEquals(v, Undefined) => null,
        JsonNode n => n.DeepClone(),
        string s => JsonValue.Create(s),
        bool b => JsonValue.Create(b),
        int i => JsonValue.Create((double)i),
        long l => JsonValue.Create((double)l),
        double d => JsonValue.Create(d),
        System.Collections.IEnumerable e => new JsonArray([.. e.Cast<object?>().Select(Node)]),
        _ => throw new ArgumentException("not a value the suites make: " + v.GetType())
    };

    /// <summary>An object of <paramref name="kv"/> in order, an undefined value's key left out.</summary>
    public static JsonObject Obj(params (string Key, object? Value)[] kv)
    {
        var o = new JsonObject();
        foreach (var (k, v) in kv) Set(o, k, v);
        return o;
    }

    /// <summary>o[k] = v as JavaScript sets it: undefined leaves the key out of the JSON.</summary>
    public static void Set(JsonObject o, string k, object? v)
    {
        if (ReferenceEquals(v, Undefined)) o.Remove(k);
        else o[k] = Node(v);
    }

    /// <summary>list[Math.floor(r() * list.length)].</summary>
    public static object? Pick(Func<double> r, IReadOnlyList<object?> list) => list[Floor(r() * list.Count)];

    /// <summary>Whether a string holds a lone surrogate (encodeURIComponent throws on one).</summary>
    public static bool HasLoneSurrogate(string s)
    {
        for (int i = 0; i < s.Length; i++)
        {
            if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { i++; continue; }
            if (char.IsSurrogate(s[i])) return true;
        }
        return false;
    }
}
