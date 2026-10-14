"use strict";
/*
 * The side menu's power button: Restart and Shut down (v0.6.12): what each
 * install can do, and how it is started again after Shut down — Docker's
 * restart policy, or however it was started (v0.6.12 to v1.0.2, the
 * Mandarin icon on a Mac too; Mac support was dropped in v1.0.3). The C#
 * server's rule (PowerRoutes.cs; lib/server/api-power.js until v0.8.50); the
 * routes run for real in test/power-csharp.test.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");

test("what each install can do, and how it starts again", { skip: built() }, () => {
  const [docker, plain, launchd] = score({ fn: "auth", powers: [
    { env: { DOCKER: "1" } },
    { env: {} },
    // A Mac's login item from before v1.0.3: nothing of its own any more.
    { env: { MANDARIN_LAUNCHD: "app.mandarin.server", XPC_SERVICE_NAME: "app.mandarin.server" } }
  ] }).powers;
  assert.deepEqual(docker, { restart: true, shutdown: false, docker: true, start_again: "docker" });
  assert.deepEqual(plain, { restart: true, shutdown: true, docker: false, start_again: "manual" });
  assert.deepEqual(launchd, plain);
});
