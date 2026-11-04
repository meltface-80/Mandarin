// Kept.cs — each room's last bit-perfect check kept (item 286): its report written beside the data, so that the verdict
// is still there after the track has changed or the server has restarted, on the track's step of Now playing's signal
// path and at /api/bitperfect, until the room's next check.
using System.Collections.Concurrent;
using System.Text.Json.Nodes;

namespace Mandarin.Server.BitPerfect;

internal static class Kept
{
    /* A room's last check: the track's title and address, and the report. */
    public sealed record Last(string Title, string Uri, JsonObject Report);

    private static readonly ConcurrentDictionary<string, Last?> read = new();

    private static string FileOf(string dir, string room) =>
        Path.Combine(dir, "bitperfect", string.Concat(room.Select(c => char.IsLetterOrDigit(c) ? c : '_')) + ".json");

    /* Room [room]'s check of the track [title] at [uri] kept, under the data folder [dir]. */
    public static void Save(string dir, string room, string title, string uri, JsonObject report)
    {
        var last = new Last(title, uri, (JsonObject)report.DeepClone());
        read[room] = last;
        try
        {
            var file = FileOf(dir, room);
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            var o = new JsonObject { ["title"] = title, ["uri"] = uri, ["report"] = report.DeepClone() };
            File.WriteAllText(file + ".part", o.ToJsonString());
            File.Move(file + ".part", file, true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* kept in memory until a restart */ }
    }

    /* Room [room]'s last check kept, or null. */
    public static Last? Of(string dir, string room) => read.GetOrAdd(room, r =>
    {
        try
        {
            if (JsonNode.Parse(File.ReadAllText(FileOf(dir, r))) is JsonObject o && o["report"] is JsonObject rep)
                return new Last((string?)o["title"] ?? "", (string?)o["uri"] ?? "", (JsonObject)rep.DeepClone());
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { /* none kept */ }
        return null;
    });

    /* Whether [a] and [b] are the same track's address: the same path, whatever the query (a stream's token changes). */
    public static bool Same(string a, string b) => a.Split('?', 2)[0] == b.Split('?', 2)[0];

    /* When [report] was made, as a date ("4 Nov"). */
    public static string When(JsonObject report) =>
        report["at"] is JsonValue v && v.TryGetValue<long>(out var ms)
            ? DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("d MMM", System.Globalization.CultureInfo.InvariantCulture)
            : "";
}
