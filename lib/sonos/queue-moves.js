"use strict";
/*
 * queue-moves.js — picks from the queue moved to just after the track playing
 * (v0.6.24: the queue's Play now and Play next on a selection). One plan for
 * every kind of player: positions are 1-based, `current` the track playing
 * (0 for none), `positions` the picks in the order they were chosen. Each
 * move says which position to take (`from`), the position it is inserted
 * before in the queue as it stands (`insertBefore`, Sonos's word) and where
 * it lands (`at`). `order` is the queue afterwards as the old positions, and
 * `first` where the first pick now sits — what Play now jumps to.
 */
function planMoves(length, current, positions) {
  const order = Array.from({ length }, (_, i) => i + 1);
  let cur = Math.max(0, Math.min(length, Number(current) || 0));
  const moves = [];
  let k = 0;
  for (const id of positions.map(Number)) {
    const p = order.indexOf(id) + 1;
    if (!p) continue;
    if (p === cur) continue;                 // the one playing stays where it is
    const t = cur + 1 + k;                   // before the item there now
    if (p === t) { k++; continue; }          // already next
    const at = p < t ? t - 1 : t;            // taking it out first shifts the rest up
    moves.push({ from: p, insertBefore: t, at });
    const [item] = order.splice(p - 1, 1);
    order.splice(at - 1, 0, item);
    if (p < cur) cur--;
    k++;
  }
  return { moves, order, current: cur, first: Math.min(length, cur + 1), moved: k };
}
module.exports = { planMoves };
