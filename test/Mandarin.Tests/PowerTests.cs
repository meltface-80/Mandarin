namespace Mandarin.Tests;

/// <summary>
/// The side menu's power button: Restart and Shut down (v0.6.12): what each install can do, and how it
/// is started again after Shut down (Mandarin OS's power button, or however it was started). The C#
/// server's rule (PowerRoutes.cs); the routes run for real in PowerCsharpTests (test/power.test.js, in C#).
/// </summary>
public sealed class PowerTests
{
    [Test]
    public async Task What_each_install_can_do_and_how_it_starts_again()
    {
        var p = (await Score.Run(new
        {
            fn = "auth",
            powers = new object[]
            {
                // A DOCKER left in the environment means nothing now (item 394: there is no image): Shut down is offered.
                new { env = new Dictionary<string, string> { ["DOCKER"] = "1" } },
                new { env = new Dictionary<string, string>() },
                // A service left by the public Linux installer, which is no more (item 426): started however it was.
                new { env = new Dictionary<string, string> { ["MANDARIN_SYSTEMD"] = "mandarin.service" } },
                // Mandarin OS (item 389), the one way Mandarin is installed (item 426): the computer shuts down with it, and
                // its power button starts it all again (there is no shell to run systemctl in).
                new { env = new Dictionary<string, string> { ["MANDARIN_OS"] = "0.1.0", ["MANDARIN_SYSTEMD"] = "mandarin.service" } },
            }
        }))["powers"].Items().ToList();
        JsonAssert.Same("""{"restart":true,"shutdown":true,"start_again":"manual"}""", p[0]);
        JsonAssert.Same(p[0]!.ToJsonString(), p[1]);
        JsonAssert.Same(p[0]!.ToJsonString(), p[2]);
        JsonAssert.Same("""{"restart":true,"shutdown":true,"start_again":"power-button"}""", p[3]);
    }

    /// <summary>
    /// How an install gets Mandarin again when an update can't put it in place (Updater.Platform.cs): Mandarin OS has
    /// no shell, so its system page's Reinstall (item 389); one put by hand, by hand.
    /// </summary>
    [Test]
    public async Task How_each_install_gets_Mandarin_again_when_an_update_can_t()
    {
        var g = (await Score.Run(new
        {
            fn = "auth",
            get_agains = new object[]
            {
                new { env = new Dictionary<string, string>() },
                new { env = new Dictionary<string, string> { ["MANDARIN_OS"] = "0.1.0", ["MANDARIN_SYSTEMD"] = "mandarin.service" } },
            }
        }))["get_agains"].Items().Select(x => (string?)x).ToList();
        Assert.Equal(["install the new version by hand", "use Reinstall Mandarin on Mandarin OS's system page (http://mandarin/, Support)"], g);
    }
}
