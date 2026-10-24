namespace Mandarin.Tests;

/// <summary>
/// The side menu's power button: Restart and Shut down (v0.6.12): what each install can do, and how it
/// is started again after Shut down (Docker's restart policy, the Mandarin icon on a Mac, or however it was started). The C#
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
                new { env = new Dictionary<string, string> { ["DOCKER"] = "1" } },
                new { env = new Dictionary<string, string>() },
                // A Mac's login item, the installer's (item 153): the Mandarin icon starts it again.
                new { env = new Dictionary<string, string> { ["MANDARIN_LAUNCHD"] = "app.mandarin.server" }, mac = true },
                // An install from before v0.6.12: launchd's own variable names the job.
                new { env = new Dictionary<string, string> { ["XPC_SERVICE_NAME"] = "app.mandarin.server" }, mac = true },
                // Started some other way on a Mac (a terminal): however it was started.
                new { env = new Dictionary<string, string> { ["XPC_SERVICE_NAME"] = "0" }, mac = true },
                // The login item's name means nothing off a Mac.
                new { env = new Dictionary<string, string> { ["MANDARIN_LAUNCHD"] = "app.mandarin.server" } },
            }
        }))["powers"].Items().ToList();
        JsonAssert.Same("""{"restart":true,"shutdown":false,"docker":true,"start_again":"docker"}""", p[0]);
        JsonAssert.Same("""{"restart":true,"shutdown":true,"docker":false,"start_again":"manual"}""", p[1]);
        JsonAssert.Same("""{"restart":true,"shutdown":true,"docker":false,"start_again":"icon"}""", p[2]);
        JsonAssert.Same(p[2]!.ToJsonString(), p[3]);
        JsonAssert.Same(p[1]!.ToJsonString(), p[4]);
        JsonAssert.Same(p[1]!.ToJsonString(), p[5]);
    }
}
