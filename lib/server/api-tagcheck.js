"use strict";
/*
 * api-tagcheck.js — the tag readers' check (v0.8.13, lib/library/tagcheck.js):
 * how far it has got, and who reads the scan's tags (v0.8.14), for Settings →
 * Library Scanner, and its report as text.
 */
module.exports = function mount(app, ctx) {
  // With who reads the scan's tags now (v0.8.14): "csharp" or "node".
  app.get("/api/tagcheck", (req, res) => {
    const v = ctx.tagcheck.verdict();
    res.json(Object.assign(ctx.tagcheck.summary(), { reader: ctx.scanner.readerNow() ? "csharp" : "node", passed: v.passed }));
  });

  app.get("/api/tagcheck/report", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.type("text/plain; charset=utf-8").send(ctx.tagcheck.report());
  });
};
