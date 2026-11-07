// Web.cs — the Bridge's own page, at its address (http://<it>:49494/): what the Android app's screen shows, for a
// computer with no screen (a Raspberry Pi by the DAC). The DAC played to, and the choice of it where more than one is
// plugged in; what plays and how the DAC is fed; its name on the network; how DSD goes; who last played to it; and the
// details to copy should something be wrong. It reads /api/state every two seconds and sets /api/settings.
namespace Mandarin.Bridge;

internal static class Web
{
    public const string Page = """
        <!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Mandarin Bridge</title>
        <style>
        :root { color-scheme: light dark; --bg: #f6f4f1; --card: #fff; --ink: #1d1b19; --dim: #6b655e; --line: #e4dfd8; --brand: #e8772e; }
        @media (prefers-color-scheme: dark) { :root { --bg: #141312; --card: #1e1c1a; --ink: #f1ede8; --dim: #a39b92; --line: #34302c; } }
        * { box-sizing: border-box; }
        body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
        main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
        h1 { font-size: 24px; margin: 0 0 4px; } .sub { color: var(--dim); margin: 0 0 20px; font-size: 14px; }
        section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
        h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 0 0 10px; }
        .status { font-size: 18px; font-weight: 600; } .dim { color: var(--dim); font-size: 14px; }
        label { display: block; font-size: 14px; color: var(--dim); margin: 10px 0 4px; }
        input, select { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); }
        button { font: inherit; font-weight: 600; padding: 10px 16px; border: 0; border-radius: 8px; background: var(--brand); color: #fff; cursor: pointer; margin-top: 12px; }
        button.quiet { background: transparent; color: var(--brand); border: 1px solid var(--line); }
        .track { display: flex; gap: 12px; align-items: center; } .track img { width: 64px; height: 64px; border-radius: 6px; object-fit: cover; background: var(--line); }
        pre { white-space: pre-wrap; word-break: break-all; font-size: 12px; color: var(--dim); max-height: 240px; overflow: auto; }
        .saved { color: var(--brand); font-size: 14px; margin-left: 8px; }
        </style></head>
        <body><main>
        <h1 id="name">Mandarin Bridge</h1>
        <p class="sub" id="sub">A USB DAC on the network for Mandarin</p>
        <section><h2>Now</h2><div class="status" id="status">…</div><div class="track" id="track" hidden><img id="art" alt=""><div><div id="title"></div><div class="dim" id="artist"></div></div></div><div class="dim" id="control"></div></section>
        <section><h2>DAC</h2><div id="dac">…</div>
          <div id="choose" hidden><label for="dacs">Play to</label><select id="dacs"></select></div>
          <p class="dim" id="dsdfix" hidden>This DAC takes DSD natively (its USB descriptor says so), but this computer's kernel offers it only as DoP. To have it natively, run this, then unplug the DAC and plug it in again (or restart):<br><code id="fixline"></code></p>
          <label for="dsd">DSD</label><select id="dsd"><option value="native">Native where the DAC takes it, else DoP</option><option value="dop">DoP only</option><option value="pcm">None (Mandarin sends PCM)</option></select>
        </section>
        <section id="wifi" hidden><h2>Wi-Fi</h2><div id="wifinow" class="dim"></div>
          <label for="ssid">Network</label><select id="ssid"></select>
          <label for="wpass">Password</label><input id="wpass" type="password" autocomplete="off">
          <button id="join">Join</button><span class="saved" id="joined"></span></section>
        <section><h2>Name</h2><label for="newname">What Mandarin and other players call it</label><input id="newname" maxlength="64"><button id="save">Save</button><span class="saved" id="saved"></span></section>
        <section><h2>Details</h2><div class="dim" id="where"></div><button class="quiet" id="copy">Copy details</button><pre id="details"></pre></section>
        </main>
        <script>
        const $ = (id) => document.getElementById(id);
        let state = null, editing = false;
        async function post(body) {
          const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); show(j); return j;
        }
        let show = function (s) {
          state = s;
          $("name").textContent = s.name; document.title = s.name + " — Mandarin Bridge";
          $("sub").textContent = "Mandarin Bridge " + s.version + (s.address ? " · " + s.address : "");
          $("status").textContent = s.status;
          const t = s.track; $("track").hidden = !t || !t.title;
          if (t) { $("title").textContent = t.title || ""; $("artist").textContent = [t.artist, t.album].filter(Boolean).join(" — "); $("art").hidden = !t.art; if (t.art) $("art").src = t.art; }
          $("control").textContent = s.mandarin ? "Played by Mandarin at " + s.mandarin.at + ", over SlimProto: last heard " + s.mandarin.seconds_ago + " s ago" : "Looking for Mandarin on the network (SlimProto, port 3483)…";
          const cur = s.dacs.find(d => d.key === s.dac);
          $("dac").textContent = cur ? cur.name + (cur.maker ? " (" + cur.maker + ")" : "") + " · " + cur.takes : "No USB DAC plugged in";
          $("choose").hidden = s.dacs.length < 2;
          const sel = $("dacs"); sel.textContent = "";
          for (const d of s.dacs) { const o = document.createElement("option"); o.value = d.key; o.textContent = d.name + " · " + d.takes; o.selected = d.key === s.dac; sel.append(o); }
          $("dsd").value = s.dsd_mode;
          $("dsdfix").hidden = !s.dsd_fix; if (s.dsd_fix) $("fixline").textContent = 'echo "' + s.dsd_fix + '" | sudo tee /etc/modprobe.d/mandarin-dsd.conf';
          if (!editing) $("newname").value = s.name;
          $("where").textContent = "Mandarin finds it on the network by itself; its DAC is also at " + (s.address || "") + "/dac.json";
          $("details").textContent = JSON.stringify(s.dac_json, null, 2);
        }
        async function tick() { try { show(await (await fetch("/api/state", { cache: "no-store" })).json()); } catch (e) { $("status").textContent = "Not answering"; } }
        $("newname").addEventListener("focus", () => { editing = true; });
        $("save").addEventListener("click", async () => { try { await post({ name: $("newname").value }); editing = false; $("saved").textContent = "Saved"; setTimeout(() => $("saved").textContent = "", 2000); } catch (e) { $("saved").textContent = String(e.message); } });
        $("dacs").addEventListener("change", () => post({ dac: $("dacs").value }));
        $("dsd").addEventListener("change", () => post({ dsd_mode: $("dsd").value }));
        $("copy").addEventListener("click", () => { const t = JSON.stringify(state, null, 2); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).catch(() => { const a = document.createElement("textarea"); a.value = t; document.body.append(a); a.select(); document.execCommand("copy"); a.remove(); }); });
        let wifiAt = 0;
        async function wifi(force) {
          if (!state || !state.wifi || (!force && Date.now() - wifiAt < 10000)) return;
          wifiAt = Date.now();
          try {
            const w = await (await fetch("/api/wifi", { cache: "no-store" })).json();
            $("wifinow").textContent = w.setup ? "No network yet: this is its setup network (" + w.setup_name + "). Choose your home network." : w.network ? "On " + w.network : "Not on a Wi-Fi network";
            const sel = $("ssid"), was = sel.value; sel.textContent = "";
            for (const n of w.networks) { const o = document.createElement("option"); o.value = n.ssid; o.textContent = n.ssid + (n.secure ? " 🔒" : "") + " · " + n.signal + "%"; o.selected = n.ssid === (was || w.network); sel.append(o); }
            if (w.error) $("joined").textContent = w.error;
          } catch (e) { /* the setup network closing as it joins */ }
        }
        $("join").addEventListener("click", async () => {
          $("joined").textContent = "Joining " + $("ssid").value + "… once it has, the page is at http://" + location.hostname.replace(/^10\.42\.0\.1$/, "mandarin-bridge.local") + ":49494/ on that network";
          await fetch("/api/wifi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ssid: $("ssid").value, password: $("wpass").value }) }).catch(() => {});
          $("wpass").value = "";
        });
        const shown0 = show;
        show = (s) => { shown0(s); $("wifi").hidden = !s.wifi; wifi(false); };
        tick(); setInterval(tick, 2000);
        </script>
        </body></html>
        """;
}
