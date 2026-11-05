// Xml.cs — the little XML the renderer reads and writes (the Android app's Xml.kt): escaping, a SOAP action's
// arguments, a DIDL-Lite item's words, and times as UPnP writes them.
using System.Globalization;
using System.Text;
using System.Xml;

namespace Mandarin.Bridge;

internal static class Xml
{
    public static string Escape(string s)
    {
        var sb = new StringBuilder(s.Length + 16);
        foreach (var ch in s)
            sb.Append(ch switch { '&' => "&amp;", '<' => "&lt;", '>' => "&gt;", '"' => "&quot;", '\'' => "&apos;", _ => ch.ToString() });
        return sb.ToString();
    }

    /* A SOAP request's one action: its name, its namespace (the service type) and its arguments by name. */
    public sealed record Action(string Name, string Service, Dictionary<string, string> Args);

    private static XmlReader Reader(string text) => XmlReader.Create(new StringReader(text),
        new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, IgnoreComments = true });

    public static Action? ParseSoap(string text)
    {
        using var r = Reader(text);
        string? action = null, service = "", arg = null;
        var args = new Dictionary<string, string>();
        var inBody = false;
        var sb = new StringBuilder();
        while (r.Read())
        {
            if (r.NodeType == XmlNodeType.Element)
            {
                if (r.LocalName == "Body" && action == null) inBody = true;
                else if (inBody && action == null) { action = r.LocalName; service = r.NamespaceURI; }
                else if (action != null && arg == null && r.Depth == 3) { arg = r.LocalName; sb.Clear(); if (r.IsEmptyElement) { args[arg] = ""; arg = null; } }
            }
            else if (r.NodeType is XmlNodeType.Text or XmlNodeType.CDATA or XmlNodeType.Whitespace or XmlNodeType.SignificantWhitespace) { if (arg != null) sb.Append(r.Value); }
            else if (r.NodeType == XmlNodeType.EndElement && arg != null && r.LocalName == arg && r.Depth == 3) { args[arg] = sb.ToString(); arg = null; }
        }
        return action == null ? null : new Action(action, service, args);
    }

    /* What a DIDL-Lite item says of a track. */
    public sealed record Didl(string Title, string Artist, string Album, string ArtUri, double Seconds);

    public static Didl ParseDidl(string text)
    {
        string title = "", artist = "", creator = "", album = "", art = "";
        double seconds = 0;
        if (string.IsNullOrWhiteSpace(text)) return new Didl("", "", "", "", 0);
        try
        {
            using var r = Reader(text);
            var sb = new StringBuilder();
            while (r.Read())
            {
                if (r.NodeType == XmlNodeType.Element)
                {
                    sb.Clear();
                    if (r.LocalName == "res" && r.GetAttribute("duration") is { } d) seconds = Seconds(d);
                }
                else if (r.NodeType is XmlNodeType.Text or XmlNodeType.CDATA) sb.Append(r.Value);
                else if (r.NodeType == XmlNodeType.EndElement)
                {
                    var t = sb.ToString().Trim();
                    switch (r.LocalName) { case "title": title = t; break; case "artist": artist = t; break; case "creator": creator = t; break; case "album": album = t; break; case "albumArtURI": art = t; break; }
                    sb.Clear();
                }
            }
        }
        catch (XmlException) { /* not DIDL-Lite: what was read stands */ }
        return new Didl(title, artist.Length > 0 ? artist : creator, album, art, seconds);
    }

    /* "H:MM:SS" (or any number of parts, a fraction allowed) as seconds; anything unreadable 0. */
    public static double Seconds(string s)
    {
        var t = s.Trim();
        if (t.Length == 0 || t == "NOT_IMPLEMENTED") return 0;
        double acc = 0;
        foreach (var part in t.Split(':'))
        {
            if (!double.TryParse(part, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)) return 0;
            acc = acc * 60 + n;
        }
        return acc;
    }

    /* Whole seconds as H:MM:SS. */
    public static string Hms(double seconds)
    {
        var s = double.IsNaN(seconds) || seconds < 0 ? 0L : (long)seconds;
        return string.Create(CultureInfo.InvariantCulture, $"{s / 3600}:{s % 3600 / 60:00}:{s % 60:00}");
    }
}
