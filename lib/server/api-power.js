"use strict";
/*
 * api-power.js: Restart and Shut down, from the power button in the side menu
 * (v0.6.12).
 *
 * Restart: the server stops cleanly and starts again. It exits 75, which
 * launcher.js (the Docker image and `npm start` run it) answers by starting it
 * again in place; any other supervisor restarts it too.
 *
 * Shut down: the server stops and stays stopped until started again.
 *   - On a Mac, with the login item the installer makes (tools/mac/install.sh),
 *     launchd would start again a job that merely exited, so the job is unloaded
 *     instead (launchctl bootout) and the Mandarin icon on the desktop loads it
 *     again. It also starts again at the next login, as before.
 *   - Anywhere else outside Docker it exits 0: launcher.js stops with it.
 *   - In Docker the container's restart policy (--restart unless-stopped) brings
 *     any exit straight back, so Shut down isn't offered: `docker stop` is the way.
 *
 * Both only from home: away (over Tailscale) a phone could switch off the
 * server it can't then reach to start again.
 */
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const RESTART_EXIT = 75;

/* The launchd job this server runs as, when it's the installer's login item. */
function launchdLabel(env = process.env) {
  const label = String(env.MANDARIN_LAUNCHD || env.XPC_SERVICE_NAME || "");
  return /^app\.mandarin\.[a-z0-9.-]+$/i.test(label) ? label : null;
}

/* What this install can do, and how it's started again after Shut down. */
function powerInfo(env = process.env, platform = process.platform) {
  const docker = env.DOCKER === "1";
  const label = platform === "darwin" ? launchdLabel(env) : null;
  return {
    restart: true,
    shutdown: !docker,
    docker,
    // "icon": the Mandarin icon on the Mac's desktop; "docker": docker start;
    // "manual": however it was started (npm start, a service manager).
    start_again: docker ? "docker" : label ? "icon" : "manual"
  };
}

module.exports = function (app, ctx, opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const spawnFn = opts.spawn || spawn;
  const stop = opts.stop;
  const exit = opts.exit || (code => process.exit(code));
  const log = ctx.log || console.log;
  const away = req => !!(ctx.auth && ctx.auth.isAway(req));
  let going = false;

  // Stop cleanly (the port, the database), then leave with `code`.
  function down(code) {
    Promise.resolve().then(() => stop && stop()).catch(e => log(`[power] stopping: ${e.message}`))
      .finally(() => exit(code));
  }

  // The login item, unloaded: launchd stops the server (SIGTERM, a clean stop)
  // and doesn't start it again until the icon or the next login loads it.
  function unloadLoginItem(label) {
    const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", label + ".plist");
    const run = (args, then) => {
      let child;
      try { child = spawnFn("launchctl", args, { detached: true, stdio: "ignore" }); }
      catch (e) { then(e); return; }
      child.on("error", then);
      child.on("exit", c => then(c === 0 ? null : new Error("launchctl " + args[0] + " exited " + c)));
      if (child.unref) child.unref();
    };
    run(["bootout", `gui/${uid}/${label}`], err => {
      if (!err) return;
      // Older launchctl, or bootout refused: the legacy form does the same.
      run(["unload", plist], err2 => {
        if (err2) { log(`[power] couldn't unload ${label}: ${err2.message}; stopping anyway`); down(0); }
      });
    });
  }

  app.get("/api/system/power", (req, res) => res.json(powerInfo(env, platform)));

  app.post("/api/system/restart", (req, res) => {
    if (away(req)) return res.status(403).json({ error: "Restart only from home", away: true });
    if (going) return res.json({ ok: true, restarting: true });
    going = true;
    log("[power] restart asked for from Settings");
    res.json({ ok: true, restarting: true });
    setTimeout(() => down(RESTART_EXIT), 300);
  });

  app.post("/api/system/shutdown", (req, res) => {
    if (away(req)) return res.status(403).json({ error: "Shut down only from home", away: true });
    const info = powerInfo(env, platform);
    if (!info.shutdown) {
      return res.status(409).json({ error: "In Docker, stop the container instead: docker stop musicd-server" });
    }
    if (going) return res.json({ ok: true, start_again: info.start_again });
    going = true;
    log("[power] shut down asked for from Settings");
    res.json({ ok: true, start_again: info.start_again });
    setTimeout(() => {
      const label = platform === "darwin" ? launchdLabel(env) : null;
      if (label) unloadLoginItem(label);
      else down(0);
    }, 300);
  });
};

module.exports.powerInfo = powerInfo;
module.exports.launchdLabel = launchdLabel;
module.exports.RESTART_EXIT = RESTART_EXIT;
