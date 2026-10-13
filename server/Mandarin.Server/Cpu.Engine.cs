// Cpu.Engine.cs — the audio engine's place on the processor (lib/cpu.js
// core() and wrap(…, "realtime"), v0.8.49, stage 6 part 4): the one core
// playback always has, and the engine started on playback's cores at a raised
// priority where the system allows.
using System.Diagnostics;

namespace Mandarin.Server;

internal static partial class Cpu
{
    /* core(): playback's own core, the one it always has; null when nothing is split. */
    public static int? Core => plan is { On: true, Playback.Length: > 0 } p ? CoreOf(p) : null;

    /* wrap(bin, args, "realtime"): the audio engine and its decoder — playback's cores, raised (nice -n -10) where allowed. */
    public static void PlaceRealtime(ProcessStartInfo psi)
    {
        var p = plan;
        Prefix(psi, ChainFor(CpuKind.Playback, Tools.Value, p.On, p.Playback, p.Background, raised: Raise.Value));
    }
}
