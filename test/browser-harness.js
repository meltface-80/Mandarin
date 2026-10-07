"use strict";
/*
 * browser-harness.js — the page itself, in a real browser, for the tests
 * that need one (v0.6.2): what a screen shows, where a button sits, what a
 * tap does. No npm package: the Chromium or Chrome already on the machine,
 * driven over the DevTools protocol through a pipe (--remote-debugging-pipe:
 * JSON messages, each ended by a NUL). CI's runners carry Chrome; where no
 * browser is found the tests skip themselves.
 *
 *   const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
 *   const page = await b.page(url, { cookies: [{ name, value, url }] });
 *   const v = await page.eval("(async () => document.title)()");
 *   await b.close();
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium",
  // Chrome itself before /usr/bin/google-chrome, which is a script that
  // starts it: killing the script would leave Chrome running.
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

/* The browser to use, or null. */
function findBrowser() {
  for (const p of CANDIDATES) {
    try { if (p && fs.statSync(p).isFile()) return p; } catch (e) { /* not there */ }
  }
  return null;
}

// A desktop: a mouse, so (hover: hover) and (pointer: fine) match. Without
// it headless Chrome reports no hover and a coarse pointer, as a tablet does.
const MOUSE = "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2";

class Browser {
  constructor(proc, dir, size) {
    this.proc = proc;
    this.dir = dir;
    this.size = size;
    this.id = 0;
    this.waiting = new Map();
    this.listeners = [];
    let buf = "";
    proc.stdio[4].on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\0")) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg.id && this.waiting.has(msg.id)) {
          const { resolve, reject } = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        } else if (msg.method) {
          for (const fn of this.listeners) fn(msg);
        }
      }
    });
  }

  static async launch({ width = 1280, height = 800, mouse = false } = {}) {
    const bin = findBrowser();
    if (!bin) throw new Error("no Chromium or Chrome found (set CHROME_PATH)");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-browser-"));
    const args = ["--headless=new", "--remote-debugging-pipe", "--no-sandbox", "--disable-gpu",
      "--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad", "--no-first-run", "--no-default-browser-check", "--mute-audio",
      "--user-data-dir=" + dir, `--window-size=${width},${height}`].concat(mouse ? [MOUSE] : [], ["about:blank"]);
    // Its own process group, so close() ends Chrome and every process it
    // started (a wrapper script's child included), not only the first.
    // A starved CI runner can take Chrome a long while to come up, or lose
    // it on the way: a minute's allowance, and a second launch before giving up.
    let last = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], detached: true });
      const b = new Browser(proc, dir, { width, height });
      let timer;
      const started = await Promise.race([
        b.send("Browser.getVersion").then(() => true, () => false),
        new Promise(r => { timer = setTimeout(() => r(false), 60000); })
      ]);
      clearTimeout(timer);
      if (started) return b;
      await b.close().catch(() => {});
      last = new Error("the browser didn't answer: " + bin + (attempt < 2 ? " (launching it again)" : ""));
      if (attempt < 2) console.log("# " + last.message);
    }
    throw last;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.proc.stdio[3].write(JSON.stringify(msg) + "\0");
    });
  }

  /*
   * A tab at url, sized like the window, with the given cookies. `init` is
   * script run in the page before any of its own (a stand-in for the Android
   * app's bridges, say), on every load of the tab.
   */
  async page(url, { cookies = [], init = null, touch = false } = {}) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => this.send(m, p, sessionId);
    const errors = [];
    this.listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        errors.push((d.exception && d.exception.description) || d.text);
      }
    });
    await s("Runtime.enable");
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width: this.size.width, height: this.size.height, deviceScaleFactor: 1, mobile: !!touch });
    // A touch screen (a phone, a tablet): pointer: coarse, hover: none.
    if (touch) await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    for (const c of cookies) await s("Network.setCookie", c);
    if (init) await s("Page.addScriptToEvaluateOnNewDocument", { source: init });
    const loaded = new Promise((resolve) => this.listeners.push((msg) => {
      if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") resolve();
    }));
    await s("Page.navigate", { url });
    await loaded;
    return {
      errors,
      /* Runs an expression in the page (a promise is awaited) → its value. */
      async eval(expression) {
        const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) {
          const d = r.exceptionDetails;
          throw new Error((d.exception && d.exception.description) || d.text);
        }
        return r.result.value;
      },
      /*
       * A real mouse: type is "mousePressed", "mouseMoved" or "mouseReleased",
       * at x, y in the page; the left button (clickCount 2 for a double-click).
       */
      async mouse(type, x, y, { clickCount = 1 } = {}) {
        await s("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount });
      },
      /* The tab as a PNG, written to `file` (a look at the page while writing a test). */
      async screenshot(file) {
        const r = await s("Page.captureScreenshot", { format: "png" });
        require("fs").writeFileSync(file, Buffer.from(r.data, "base64"));
      }
    };
  }

  async close() {
    const exited = new Promise(r => this.proc.exitCode !== null ? r() : this.proc.once("exit", r));
    // Killed outright, the whole group: Chrome's own helpers (Google Chrome's
    // crash reporter among them) can outlive it holding the DevTools pipe,
    // which kept the test's process alive for minutes on GitHub's runners.
    try { process.kill(-this.proc.pid, "SIGKILL"); } catch (e) { /* the group is gone */ }
    try { this.proc.kill("SIGKILL"); } catch (e) { /* gone */ }
    // Nothing of the browser may keep the test's process alive afterwards.
    for (const p of [this.proc.stdio[3], this.proc.stdio[4]]) { try { p.destroy(); } catch (e) { /* closed */ } }
    for (const { reject } of this.waiting.values()) reject(new Error("browser closed"));
    this.waiting.clear();
    let timer;
    await Promise.race([exited, new Promise(r => { timer = setTimeout(r, 2000); })]);
    clearTimeout(timer);
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { /* left behind */ }
  }
}

module.exports = { Browser, findBrowser, MOUSE };
