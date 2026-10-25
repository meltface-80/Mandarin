// Tailscale.Exit.cs — which engine has left (bug list item 181). A Restart lets go of the engine (its input
// closed, killed 1.5 s on) and starts the next 300 ms later, so the old one can leave after the new one has
// started: its leaving then cancelled the new one's asking, said the engine had stopped and started one again.
// Only the current engine's leaving counts; an earlier one's touches nothing.

namespace Mandarin.Server.Admin;

internal sealed partial class Tailscale
{
    /* Under gate: [p] let go of when it is the current engine (true); false, nothing touched, when it isn't (one let go of before, by Stop). */
    private bool LetGo(System.Diagnostics.Process p)
    {
        if (proc != p) return false;
        proc = null;
        ctl = null;
        return true;
    }
}
