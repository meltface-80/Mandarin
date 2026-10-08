"use strict";
/*
 * api-cpu.js — how the processor is shared out (v0.8.13, lib/cpu.js): the
 * cores playback keeps and the rest, for Settings → Library Scanner.
 */
const CPU = require("../cpu");

module.exports = function mount(app) {
  app.get("/api/cpu", (req, res) => res.json(CPU.plan()));
};
