// StreamPlans.Upsamplable.cs — which tracks Mandarin's own upsampler may make (item 440): a file of the library, or a
// Qobuz track, which comes from one address (track/getFileUrl) its decode reads as it reads a file, or an iBroadcast
// track, its original file at one address likewise (item 445). Not Tidal's: its
// hi-res comes as DASH pieces fed to ffmpeg one after another, which the upsampler doesn't read. Asked where a plan is
// shaped or made DSD (Upsample/MadeAsPlayed.cs, Upsample/DsdPlan.cs), where a stream is answered (Streams.cs), where the
// output's safety watches the making (Renderers/Players.Safety.cs) and where the signal path says "Not DSD".
namespace Mandarin.Server.Playback;

internal static partial class StreamPlans
{
    /* Whether Mandarin's own upsampler may make the track at [path]: a file, a Qobuz track or an iBroadcast one. */
    public static bool Upsamplable(object? path) => ServiceOf(path) is null or "qobuz" or "ibroadcast";
}
