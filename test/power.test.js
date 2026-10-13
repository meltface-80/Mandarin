"use strict";
/*
 * The side menu's power button: Restart and Shut down (v0.6.12): what each
 * install can do, and how it is started again after Shut down — Docker's
 * restart policy, the Mandarin icon on a Mac (the installer's login item), or
 * however it was started. The C# server's rule (PowerRoutes.cs;
 * lib/server/api-power.js until v0.8.50), for any platform; the routes run for
 * real in test/power-csharp.test.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");

test("what each install can do, and how it starts again", { skip: built() }, () => {
  const [docker, launchd, older, terminal, linux] = score({ fn: "auth", powers: [
    { env: { DOCKER: "1" } },
    { env: { MANDARIN_LAUNCHD: "app.mandarin.server" }, mac: true },
    // An install from before v0.6.12: launchd's own variable names the job.
    { env: { XPC_SERVICE_NAME: "app.mandarin.server" }, mac: true },
    // Terminal's XPC_SERVICE_NAME is "0": not a login item.
    { env: { XPC_SERVICE_NAME: "0" }, mac: true },
    // The login item's name means nothing off a Mac.
    { env: { MANDARIN_LAUNCHD: "app.mandarin.server" } }
  ] }).powers;
  assert.deepEqual(docker, { restart: true, shutdown: false, docker: true, start_again: "docker" });
  assert.deepEqual(launchd, { restart: true, shutdown: true, docker: false, start_again: "icon" });
  assert.equal(older.start_again, "icon");
  assert.equal(terminal.start_again, "manual");
  assert.equal(linux.start_again, "manual");
});
