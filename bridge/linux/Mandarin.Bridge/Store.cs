// Store.cs — what the Bridge keeps (the Android app's Store.kt): its name on the network, its UDN (made once, kept
// for good: its SlimProto id is made from it, so Mandarin knows it after a restart), the DAC chosen where more than one
// is plugged in, and how DSD goes (native where it can, DoP only, or none). One JSON file in its data folder.
using System.Text.Json.Nodes;

namespace Mandarin.Bridge;

internal sealed class Store(string dir)
{
    private readonly object gate = new();
    private string FilePath => Path.Combine(dir, "settings.json");
    private JsonObject? data;

    private JsonObject Data
    {
        get
        {
            if (data != null) return data;
            try { data = JsonNode.Parse(File.ReadAllText(FilePath)) as JsonObject; }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { /* none yet */ }
            return data ??= [];
        }
    }

    private string Get(string key, string fallback) { lock (gate) return Data[key] is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : fallback; }

    private void Set(string key, string value)
    {
        lock (gate)
        {
            Data[key] = value;
            Directory.CreateDirectory(dir);
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, Data.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            File.Move(tmp, FilePath, true);
        }
    }

    public string Udn
    {
        get
        {
            var u = Get("udn", "");
            if (u.Length == 0) { u = "uuid:" + Guid.NewGuid(); Set("udn", u); }
            return u;
        }
    }

    public string Name { get => Get("name", "Mandarin Bridge (" + Environment.MachineName + ")"); set => Set("name", value.Trim()); }

    /* The DAC chosen (its Key), "" for the first one found. */
    public string Dac { get => Get("dac", ""); set => Set("dac", value); }

    /* "native" (natively where the DAC takes it, else DoP), "dop" (DoP only), or "pcm" (no DSD: the server makes it PCM). */
    public string DsdMode { get => Get("dsd", "native"); set => Set("dsd", value is "dop" or "pcm" ? value : "native"); }
}
