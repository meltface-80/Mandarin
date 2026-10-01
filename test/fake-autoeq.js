"use strict";
/*
 * A stand-in for AutoEq's results on GitHub: the index and two profiles,
 * served as raw.githubusercontent.com would.
 */
const http = require("http");

const INDEX = `# Index
This is a list of all equalization profiles.

- [Sennheiser HD 650](./oratory1990/over-ear/Sennheiser%20HD%20650) by oratory1990
- [Sennheiser HD 650](./crinacle/GRAS%2043AG-7%20over-ear/Sennheiser%20HD%20650) by crinacle on GRAS 43AG-7
- [Sennheiser HD 600](./oratory1990/over-ear/Sennheiser%20HD%20600) by oratory1990
- [Moondrop Aria](./crinacle/711%20in-ear/Moondrop%20Aria) by crinacle on 711
`;

const PROFILES = {
  "oratory1990/over-ear/Sennheiser HD 650": `Preamp: -6.1 dB
Filter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70
Filter 2: ON PK Fc 8800 Hz Gain 5.1 dB Q 1.42
Filter 3: ON PK Fc 118 Hz Gain -3.1 dB Q 0.50
Filter 4: OFF PK Fc 37 Hz Gain 0.7 dB Q 3.96
Filter 5: ON HSC Fc 10000 Hz Gain -2.1 dB Q 0.70
`,
  "crinacle/711 in-ear/Moondrop Aria": `Preamp: -2.0 dB
Filter 1: ON PK Fc 2000 Hz Gain 1.5 dB Q 1.00
`
};

class FakeAutoEq {
  constructor() { this.hits = []; this.server = null; this.base = ""; }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const p = decodeURIComponent(req.url.split("?")[0]);
        this.hits.push(p);
        if (p === "/INDEX.md") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(INDEX); }
        const m = /^\/(.+)\/([^/]+) ParametricEQ\.txt$/.exec(p);
        const text = m && PROFILES[m[1]];
        if (text) { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(text); }
        res.writeHead(404); res.end("not found");
      });
      this.server.listen(0, "127.0.0.1", () => { this.base = `http://127.0.0.1:${this.server.address().port}`; resolve(this.base); });
    });
  }
  stop() { return new Promise(r => this.server ? this.server.close(() => r()) : r()); }
}

module.exports = { FakeAutoEq, INDEX, PROFILES };
