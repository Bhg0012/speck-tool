'use strict';
// Moving Speck to another monitor while keeping the same layout. Pure, so it's unit-tested.
// Displays and rects use Electron's screen coordinates (points); `wa` is a display's work area.

// Monitors left to right (then top to bottom); the one after `fromId`, wrapping around.
function nextDisplay(displays, fromId) {
  const sorted = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  const i = sorted.findIndex((d) => d.id === fromId);
  return sorted[(i + 1) % sorted.length];
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// The capture area keeps its size and sits at the same relative spot (its centre is mapped
// proportionally), shrunk only if the other monitor is too small for it.
function moveRegion(r, from, to) {
  const width = Math.min(r.width, to.width);
  const height = Math.min(r.height, to.height);
  const cx = to.x + ((r.x + r.width / 2 - from.x) / from.width) * to.width;
  const cy = to.y + ((r.y + r.height / 2 - from.y) / from.height) * to.height;
  return {
    x: Math.round(clamp(cx - width / 2, to.x, to.x + to.width - width)),
    y: Math.round(clamp(cy - height / 2, to.y, to.y + to.height - height)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

// The dot keeps its distance from the nearest edges (bottom-right stays bottom-right).
function moveDot(p, size, from, to) {
  const right = p.x + size / 2 > from.x + from.width / 2;
  const bottom = p.y + size / 2 > from.y + from.height / 2;
  const x = right ? to.x + to.width - (from.x + from.width - p.x) : to.x + (p.x - from.x);
  const y = bottom ? to.y + to.height - (from.y + from.height - p.y) : to.y + (p.y - from.y);
  return {
    x: Math.round(clamp(x, to.x, to.x + to.width - size)),
    y: Math.round(clamp(y, to.y, to.y + to.height - size)),
  };
}

module.exports = { nextDisplay, moveRegion, moveDot };
