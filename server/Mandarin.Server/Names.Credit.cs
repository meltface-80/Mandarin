// Names.Credit.cs — the first act a credit names ("Daft Punk feat. Pharrell" → "Daft Punk"), as Smart Picks, the
// release days and the write-ups ask an act by (out of Extras/ShareLinks.cs, item 336: the links under the share card
// are gone, this rule of theirs kept). A credit is split at " / ", ";" and "feat." (", ft." and "featuring"); a credit
// that splits into nothing is kept whole.
using System.Text.RegularExpressions;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Names
{
    private const string CreditWs = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

    // /\s+\/\s*|\s*\/\s+|\s*;\s*|\s+(?:feat\.?|ft\.?|featuring)\s+/i
    [GeneratedRegex(CreditWs + "+/" + CreditWs + "*|" + CreditWs + "*/" + CreditWs + "+|" + CreditWs + "*;" + CreditWs + "*|" + CreditWs
        + "+(?:[fF][eE][aA][tT]\\.?|[fF][tT]\\.?|[fF][eE][aA][tT][uU][rR][iI][nN][gG])" + CreditWs + "+")]
    private static partial Regex CreditSeparator();

    /* The first credited act. */
    public static string PrimaryArtist(object? artist)
    {
        var whole = TJs.Trim(TJs.IsNullish(artist) ? "" : TJs.Str(artist));
        if (whole.Length == 0) return "";
        var first = TJs.Trim(CreditSeparator().Split(whole)[0]);
        return first.Length > 0 ? first : whole;
    }
}
