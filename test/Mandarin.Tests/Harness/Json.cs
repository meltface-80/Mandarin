using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>Reading the server's JSON in a test: what a field holds, said shortly.</summary>
public static class JsonExtensions
{
    /// <summary>The node's elements (none when it isn't an array).</summary>
    public static IEnumerable<JsonNode?> Items(this JsonNode? n) => n is JsonArray a ? a : [];

    /// <summary>The string at <paramref name="key"/>, or null.</summary>
    public static string? Str(this JsonNode? n, string key) => n?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>The number at <paramref name="key"/>, or null.</summary>
    public static double? Num(this JsonNode? n, string key) =>
        n?[key] is JsonValue v ? v.TryGetValue<double>(out var d) ? d : v.TryGetValue<long>(out var l) ? l : v.TryGetValue<int>(out var i) ? i : null : null;

    /// <summary>The boolean at <paramref name="key"/>, or null.</summary>
    public static bool? Bool(this JsonNode? n, string key) => n?[key] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;

    /// <summary>The strings of an array field, in order.</summary>
    public static List<string?> Strs(this JsonNode? n, string key)
    {
        var list = new List<string?>();
        foreach (var x in (n?[key]).Items()) list.Add(x is JsonValue v && v.TryGetValue<string>(out var s) ? s : x?.ToJsonString());
        return list;
    }
}

/// <summary>JSON compared as assert.deepEqual compares: the same values, an object's keys in any order.</summary>
public static class JsonAssert
{
    /// <summary>Fails unless <paramref name="actual"/> is the JSON <paramref name="expected"/> says.</summary>
    public static void Same(string expected, JsonNode? actual, string? because = null)
    {
        var want = JsonNode.Parse(expected);
        if (!JsonNode.DeepEquals(want, actual))
            throw new Xunit.Sdk.XunitException((because != null ? because + ": " : "") + "expected " + want?.ToJsonString() + "\n but was " + (actual?.ToJsonString() ?? "null"));
    }
}
