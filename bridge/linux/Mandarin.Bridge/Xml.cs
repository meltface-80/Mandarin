// Xml.cs — the little XML the Bridge still writes (the Android app's Xml.kt): an error's words, escaped.
using System.Text;

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
}
