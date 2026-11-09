// Updater.Retry.cs — an update's downloads tried again where GitHub's download service fails for a moment (item 380):
// it answers 502 or 504 now and then for a file that is there, or drops the connection, and an update stopped at the
// first such answer ("download HTTP 504") though the next would have worked. A file it says isn't there (404), or
// refuses, is said at once, as before.
namespace Mandarin.Server.Admin;

internal sealed partial class Updater
{
    private const int Tries = 4;

    /* [url] downloaded to [dest], tried again (four times in all, a few seconds apart) where the failure is a passing one. */
    private async Task Download(string url, string dest)
    {
        for (var attempt = 1; ; attempt++)
        {
            try { await DownloadOnce(url, dest); return; }
            catch (UpdateError e) when (attempt < Tries && Passing(e.Message))
            {
                log($"[update] {e.Message}; trying again ({attempt} of {Tries - 1})");
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2));
            }
        }
    }

    /* Whether a download's failure is one a moment later may not have: a 5xx, a timeout, the connection lost. */
    internal static bool Passing(string why) =>
        why.StartsWith("download HTTP 5", StringComparison.Ordinal) || why == "download timed out"
        || !(why.StartsWith("download HTTP", StringComparison.Ordinal) || why == "too many redirects");
}
