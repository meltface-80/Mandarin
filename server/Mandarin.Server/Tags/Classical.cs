// Classical.cs — what a file's tags say of a classical track (bug list item 48):
// the composer, the conductor, the work and the movement, and who performs it.
// Read beside the common tags (TagReader.ReadTags) into the track's row, from
// the common fields where music-metadata maps them (COMPOSER, CONDUCTOR, WORK;
// MP4's and ID3's movement name and number) and from the raw tags where it
// doesn't (Vorbis's MOVEMENTNAME, MOVEMENT, PERFORMER and ENSEMBLE, as Picard
// and most rippers write them). Null where the tags have none.
namespace Mandarin.Server.Tags;

internal static class Classical
{
    /* The fields into [r]: composer, conductor, work, movement, movement_no, performers. */
    public static void Fill(JsObj r, JsObj c, JsObj tags)
    {
        r["composer"] = Names(c["composer"]);
        r["conductor"] = Names(c["conductor"]) ?? Text(Raw(tags, "CONDUCTOR"));
        r["work"] = Text(c["work"]) ?? Text(Raw(tags, "WORK"));
        r["movement"] = Text(c["movement"]) ?? Text(Raw(tags, "MOVEMENTNAME"));
        var index = c["movementIndex"] as JsObj;
        var no = index is not null && Js.Truthy(index["no"]) ? Js.ToNumber(index["no"]) : Js.ParseInt(Text(Raw(tags, "MOVEMENT")));
        r["movement_no"] = double.IsFinite(no) && no > 0 ? (object?)no : null;
        // Each performer as the tags name them ("Kronos Quartet", "Anne-Sophie Mutter (violin)"), one after another.
        var performers = Raw(tags, "PERFORMER").Concat(Raw(tags, "ENSEMBLE")).Select(Js.Str).Select(Js.Trim).Where(s => s.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        r["performers"] = performers.Count > 0 ? string.Join("; ", performers) : null;
    }

    private static List<object?> Raw(JsObj tags, string key) => tags[key] as List<object?> ?? [];

    /* One or several names, as one text: "A, B". */
    private static string? Names(object? v)
    {
        List<object?> list = v is List<object?> l ? l : Js.IsNullish(v) ? [] : [v];
        var names = list.Where(x => !Js.IsNullish(x)).Select(x => Js.Trim(Js.Str(x))).Where(s => s.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        return names.Count > 0 ? string.Join(", ", names) : null;
    }

    private static string? Text(object? v)
    {
        if (v is List<object?> l) v = l.Count > 0 ? l[0] : null;
        if (Js.IsNullish(v)) return null;
        var s = Js.Trim(Js.Str(v));
        return s.Length > 0 ? s : null;
    }
}
