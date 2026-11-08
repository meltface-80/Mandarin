// Auth.Names.cs — a device's name from its browser's user agent, as it is listed in Settings → Account (moved out of
// Auth.cs, which only shrinks, item 363).
namespace Mandarin.Server;

internal static partial class Auth
{
    // "iPhone · Safari" from a browser's user agent — enough to tell devices apart.
    public static string DeviceNameFromUA(string ua)
    {
        string s = ua ?? "";
        bool has(string x) => s.Contains(x, StringComparison.Ordinal);
        string os = has("iPhone") ? "iPhone" : has("iPad") ? "iPad" : has("Android") ? "Android"
            : has("Macintosh") ? "Mac" : has("Windows") ? "Windows" : has("CrOS") ? "Chromebook"
            : has("Linux") ? "Linux" : "Browser";
        string br = has("Edg/") ? "Edge" : has("Firefox/") ? "Firefox" : (has("CriOS") || has("Chrome/")) ? "Chrome"
            : has("Safari/") ? "Safari" : "";
        return br.Length > 0 ? $"{os} · {br}" : os;
    }
}
