// Pack.Barcode.cs — a release's barcode by its MusicBrainz id, from the pack (item 442; out of Pack.cs, which only
// shrinks): files tagged by MusicBrainz Picard carry the release's id (MUSICBRAINZ_ALBUMID) more often than its barcode,
// and the library export gives Mandarin Migration the barcode, the strongest match there is. The pack keeps a code
// without its leading zeros (CodeOf); a UPC's are put back (twelve digits), an EAN's thirteen are as they are.
using System.Globalization;

namespace Mandarin.Server.Identify;

internal sealed partial class MbPack
{
    /// <summary>The barcode of the release [mbid] as digits (12 at least), or null where the pack hasn't the release.</summary>
    public string? BarcodeOf(string? mbid)
    {
        var b = GidBlob(mbid);
        if (b == null) return null;
        var rows = Query("SELECT code FROM releases WHERE gid = $1 LIMIT 1", b);
        if (rows.Count == 0 || rows[0][0] is not { } v) return null;
        var code = Convert.ToString(v, CultureInfo.InvariantCulture) ?? "";
        if (code.Length == 0 || !code.All(char.IsAsciiDigit)) return null;
        return code.Length < 12 ? code.PadLeft(12, '0') : code;
    }
}
