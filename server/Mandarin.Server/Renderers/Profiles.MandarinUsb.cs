// Profiles.MandarinUsb.cs — the chips of a Mandarin USB renderer that has said what its DAC takes
// (MandarinUsb.cs Said): its word is the whole of it, as a Roon Ready device's is. What the DAC takes is on and
// nothing else is: no profile, no floor, nothing to tick. Yours can only turn one off (a rate you would rather
// Mandarin didn't send); a tick for what the DAC doesn't take changes nothing, and a list of yours from before the
// device said, every chip ticked by hand, leaves its word as it is. Its volume is the DAC's: fixed where the DAC
// has no USB volume control, Mandarin's slider where it has.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

using Js = Mandarin.Server.Tags.Js;

internal static partial class Profiles
{
    public const string DeviceSaysNote =
        "What the DAC on this device takes, as the Mandarin USB app on it says: nothing to tick. Tap one to keep Mandarin from sending it.";

    private static JsObj DeviceSays(JsObj o, JsObj said, object? user, object? verified, object? containers, object? record)
    {
        (bool On, string Source) Pick(double v, string key)
        {
            var mine = Js.Truthy(user) ? Prop.Get(user, key) as List<object?> : null;
            var on = Includes(said[key] as List<object?> ?? [], v) && (mine == null || Includes(mine, v));
            var layer = Prop.Get(verified, key);
            var isVerified = Js.Truthy(layer) && Js.Truthy(Prop.Get(layer, Js.Num(v)));
            return (on, !on ? "off" : isVerified ? "verified" : "advertised");
        }

        var profile = new JsObj();
        profile["id"] = "mandarin-usb";
        profile["label"] = MandarinUsb.Model;
        profile["notes"] = DeviceSaysNote;
        profile["setNext"] = true;
        profile["api"] = "mandarin-usb";
        profile["volume"] = Jv.Same(said["volume"], "upnp") ? "upnp" : "fixed";
        o["profile"] = profile;
        o["rates"] = Rates.Select(hz => { var (on, source) = Pick(hz, "rates"); return (object?)Chip("hz", hz, on, source); }).ToList();
        o["bits"] = Bits.Select(n => { var (on, source) = Pick(n, "bits"); return (object?)Chip("n", n, on, source); }).ToList();
        o["dsd"] = Dsd.Select(n => { var (on, source) = Pick(n, "dsd"); return (object?)Chip("n", n, on, source); }).ToList();
        o["containers"] = containers;
        o["editable"] = true;
        o["playable"] = Js.Truthy(Prop.Get(record, "playable"));
        return o;
    }
}
