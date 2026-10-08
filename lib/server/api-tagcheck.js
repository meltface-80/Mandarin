"use strict";
/*
 * api-tagcheck.js — the tag readers' check (v0.8.13, lib/library/tagcheck.js):
 * how far it has got, for Settings → Library Scanner, and its report as text.
 */
module.exports = function mount(app, ctx) {
  app.get("/api/tagcheck", (req, res) => res.json(ctx.tagcheck.summary()));

  app.get("/api/tagcheck/report", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.type("text/plain; charset=utf-8").send(ctx.tagcheck.report());
  });
};
