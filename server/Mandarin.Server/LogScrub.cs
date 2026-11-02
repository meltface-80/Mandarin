// LogScrub.cs — what is taken out of a line of the server's log before it is kept for the app (bug list item 235;
// Diagnostics.cs). From item 121 a kept line held the code's own words and numbers alone: every name, address, title
// and message became […], the cause of a failure with them (on 2 November 30,767 Qobuz watch failures, not one of
// which said why). The owner's rule since: hide what is theirs alone, keep what helps find what went wrong.
//
// Hidden: keys, tokens and passwords (token=[…], Bearer […], a run of 32 or more letters and figures); email
// addresses ([email]); the account names and logins a line names (put in as Personal); internet (WAN) addresses
// ([wan]); Tailscale's addresses (100.64.0.0/10, fd7a:115c:a1e0::/48) and names (*.ts.net) ([tailscale]); the
// user's own folder in a path (/home/[user]/…).
// Kept: everything else. Home-network addresses (192.168.x.x, 10.x.x.x, 172.16–31.x.x, fe80::, 127.0.0.1), rooms'
// and devices' names and ids, titles, files and folders, error messages.
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

/* A value a line names that is someone's alone (an account's name, a service's login): in the console as it is, kept as […]. */
internal readonly struct Personal(string? value)
{
    public override string ToString() => value ?? "";
}

internal static partial class LogScrub
{
    /* [s] as kept: without what is the owner's alone. */
    public static string Line(string s)
    {
        var t = UrlLogin().Replace(s, "$1" + Diagnostics.Withheld + "@");
        t = Bearer().Replace(t, "$1 " + Diagnostics.Withheld);
        t = Secret().Replace(t, "$1$2" + Diagnostics.Withheld);
        t = Email().Replace(t, "[email]");
        t = Long().Replace(t, m => Uuid().IsMatch(m.Value) ? m.Value : Diagnostics.Withheld);
        t = V4().Replace(t, m => V4Kind(m.Value) ?? m.Value);
        t = V6().Replace(t, m => V6Kind(m.Value) ?? m.Value);
        t = Tailnet().Replace(t, "[tailscale]");
        return HomeFolder().Replace(t, "$1[user]");
    }

    /* An IPv4 address's kind when it is to be hidden ("[wan]", "[tailscale]"), or null when it is kept (or isn't one). */
    private static string? V4Kind(string s)
    {
        var o = s.Split('/')[0].Split('.').Select(x => int.Parse(x, CultureInfo.InvariantCulture)).ToArray();
        if (o.Any(x => x > 255)) return null;
        var (a, b) = (o[0], o[1]);
        if (a is 0 or 10 or 127 || a >= 224 || (a == 169 && b == 254) || (a == 172 && b is >= 16 and <= 31) || (a == 192 && b == 168) || (a == 192 && b == 0 && o[2] == 0)) return null;
        return a == 100 && b is >= 64 and <= 127 ? "[tailscale]" : "[wan]";
    }

    /* An IPv6 address's kind when it is to be hidden, or null when it is kept: link-local, private, loopback, multicast. */
    private static string? V6Kind(string s)
    {
        var t = s.ToLowerInvariant();
        if (t.StartsWith("fd7a:115c:a1e0:", StringComparison.Ordinal)) return "[tailscale]";
        var head = t.Split(':')[0];
        if (head.Length == 0) return null;
        var h = int.Parse(head, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        return h is >= 0x2000 and <= 0x3fff ? "[wan]" : null;
    }

    [GeneratedRegex(@"(://)[^/\s:@]+:[^/\s@]+@")]
    private static partial Regex UrlLogin();
    [GeneratedRegex(@"\b(Bearer|Basic)\s+[^\s&,;]+")]
    private static partial Regex Bearer();
    [GeneratedRegex(@"(?i)\b([\w-]*(?:token|password|passwd|pwd|secret|apikey|api[_-]key|sig|signature|authorization|cookie))(\s*[=:]\s*)(?!\[…\])[^\s&,;]+")]
    private static partial Regex Secret();
    [GeneratedRegex(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")]
    private static partial Regex Email();
    [GeneratedRegex(@"\b[A-Za-z0-9_-]{32,}\b")]
    private static partial Regex Long();
    [GeneratedRegex(@"\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z")]
    private static partial Regex Uuid();
    [GeneratedRegex(@"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?(?![\w.])")]
    private static partial Regex V4();
    [GeneratedRegex(@"(?<![\w:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?)(?:%[\w.-]+)?(?![\w:.])")]
    private static partial Regex V6();
    [GeneratedRegex(@"\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b")]
    private static partial Regex Tailnet();
    [GeneratedRegex(@"(?<![\w.])(/home/|/Users/|[A-Za-z]:\\Users\\)[^/\\\s]+")]
    private static partial Regex HomeFolder();
}
