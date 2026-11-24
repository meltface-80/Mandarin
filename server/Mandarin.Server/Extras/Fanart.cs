// Fanart.cs — FanArt.tv, for artist photos (artist pages, Credits/CreditFinder.cs;
// the wall display, HousekeepingRoutes.cs): where it is and the key it is asked with,
// Mandarin's own (item 491) unless one was saved before.
namespace Mandarin.Server.Extras;

internal static class Fanart
{
    public const string Base = "https://webservice.fanart.tv";

    /* The key: one saved in an earlier version, else Mandarin's own. */
    public static string Key() => SavedSettings.Setting("fanartKey") is var v && Tags.Js.Truthy(v) && Tags.Js.Str(v) is { Length: > 0 } saved ? saved : BuiltInKeys.Fanart;
}
