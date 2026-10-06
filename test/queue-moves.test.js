"use strict";
/* The plan behind the queue's Play now / Play next on a selection (v0.6.24). */
const test = require("node:test");
const assert = require("node:assert");
const { planMoves } = require("../lib/sonos/queue-moves");

test("picks land after the track playing, in the order picked", () => {
  const p = planMoves(6, 2, [5, 4]);
  assert.deepEqual(p.order, [1, 2, 5, 4, 3, 6]);
  assert.deepEqual(p.moves, [{ from: 5, insertBefore: 3, at: 3 }, { from: 5, insertBefore: 4, at: 4 }]);
  assert.equal(p.first, 3);
});
test("a pick from before the track playing: the track playing moves up one", () => {
  const p = planMoves(6, 3, [1]);
  assert.deepEqual(p.order, [2, 3, 1, 4, 5, 6]);
  assert.equal(p.current, 2); assert.equal(p.first, 3);
});
test("nothing playing: picks go to the top; the one playing and one already next stay", () => {
  assert.deepEqual(planMoves(6, 0, [6, 2]).order, [6, 2, 1, 3, 4, 5]);
  const p = planMoves(6, 2, [3, 2]);
  assert.deepEqual(p.moves, []); assert.deepEqual(p.order, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(planMoves(3, 1, [9]).moves, [], "a position that isn't there is ignored");
});
