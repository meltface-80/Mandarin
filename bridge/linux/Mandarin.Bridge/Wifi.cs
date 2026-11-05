// Wifi.cs — the Bridge's Wi-Fi, set from its own page (item 283), for a computer with no screen and no network yet (a
// Raspberry Pi just flashed): through NetworkManager (nmcli), which Raspberry Pi OS uses. Where the computer has no
// network a while after it starts, it opens a setup network of its own ("Mandarin Bridge Setup"); one joins it, opens
// the page (http://10.42.0.1:49494/), chooses the home network and gives its password, and the Bridge joins it, the
// setup network closed. Should that fail, the setup network opens again. Only where the Bridge was started with --wifi.
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Bridge;

internal sealed class Wifi(string nmcli, Action<string> log)
{
    public const string SetupName = "Mandarin Bridge Setup", SetupPassword = "mandarin-setup", SetupConnection = "mandarin-setup";
    private readonly object gate = new();
    public bool Hotspot { get; private set; }
    public string? LastError { get; private set; }

    // nmcli [args], its output; null where it failed (and why, in LastError).
    private string? Run(params string[] args)
    {
        try
        {
            var psi = new ProcessStartInfo(nmcli) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            var output = p.StandardOutput.ReadToEndAsync();
            var err = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(45000)) { try { p.Kill(true); } catch (InvalidOperationException) { /* gone */ } LastError = "nmcli didn't answer"; return null; }
            if (p.ExitCode != 0) { LastError = (err.Result.Trim() is { Length: > 0 } e ? e : output.Result.Trim()); return null; }
            return output.Result;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { LastError = "nmcli isn't here: " + e.Message; return null; }
    }

    /* nmcli's terse fields of one line ("a:b\:c" → a, b:c). */
    public static List<string> Fields(string line)
    {
        var o = new List<string>();
        var sb = new StringBuilder();
        for (var i = 0; i < line.Length; i++)
        {
            if (line[i] == '\\' && i + 1 < line.Length) { sb.Append(line[++i]); continue; }
            if (line[i] == ':') { o.Add(sb.ToString()); sb.Clear(); continue; }
            sb.Append(line[i]);
        }
        o.Add(sb.ToString());
        return o;
    }

    /* Whether the computer is on a network: NetworkManager's word (full, limited, portal) or none. */
    public bool Connected() => (Run("-t", "networking", "connectivity") ?? "").Trim() is "full" or "limited" or "portal";

    /* What the page shows: the network it is on, the setup network's state, and the networks in reach (strongest first). */
    public JsonObject State()
    {
        string? current = null;
        foreach (var l in (Run("-t", "-f", "ACTIVE,SSID", "device", "wifi") ?? "").Split('\n'))
            if (Fields(l) is [var active, var ssid, ..] && active == "yes" && ssid != SetupName) current = ssid;
        var seen = new Dictionary<string, (int Signal, string Security)>();
        foreach (var l in (Run("-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list") ?? "").Split('\n'))
        {
            if (Fields(l) is not [var ssid, var sig, var sec, ..] || ssid.Length == 0 || ssid == SetupName) continue;
            var s = int.TryParse(sig, out var n) ? n : 0;
            if (!seen.TryGetValue(ssid, out var was) || was.Signal < s) seen[ssid] = (s, sec);
        }
        return new JsonObject
        {
            ["network"] = current, ["setup"] = Hotspot, ["setup_name"] = SetupName, ["error"] = LastError,
            ["networks"] = new JsonArray([.. seen.OrderByDescending(x => x.Value.Signal).Select(x => (JsonNode)new JsonObject
                { ["ssid"] = x.Key, ["signal"] = x.Value.Signal, ["secure"] = x.Value.Security.Trim().Length > 0 && x.Value.Security.Trim() != "--" })]),
        };
    }

    /* The setup network opened (where there is no other). */
    public void OpenSetup()
    {
        lock (gate)
        {
            if (Hotspot) return;
            if (Run("device", "wifi", "hotspot", "con-name", SetupConnection, "ssid", SetupName, "password", SetupPassword) != null) { Hotspot = true; log($"[wifi] no network: \"{SetupName}\" open (password {SetupPassword}); the page at http://10.42.0.1:49494/"); }
            else log("[wifi] the setup network couldn't open: " + LastError);
        }
    }

    /* The home network [ssid] joined with [password], the setup network closed first; false (and why) where it didn't join. */
    public bool Join(string ssid, string password)
    {
        lock (gate)
        {
            if (Hotspot) { Run("connection", "down", SetupConnection); Hotspot = false; }
            var args = new List<string> { "device", "wifi", "connect", ssid };
            if (password.Length > 0) { args.Add("password"); args.Add(password); }
            var ok = Run([.. args]) != null;
            log(ok ? $"[wifi] joined \"{ssid}\"" : $"[wifi] couldn't join \"{ssid}\": {LastError}");
            if (ok) LastError = null;
            return ok;
        }
    }
}
