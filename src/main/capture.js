'use strict';
const { desktopCapturer, screen } = require('electron');

const MAX_SIDE = 1280; // ~800 image tokens: fast, and text stays sharp (Retina captures are 2x)
const MIN_SIDE = 480; // upscale tiny regions so small text stays readable

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return r > x && btm > y ? { x, y, width: r - x, height: btm - y } : null;
}

/**
 * Captures a screen-point rectangle and returns a base64 PNG.
 * If the rectangle spans monitors, the monitor holding most of it is used.
 */
async function captureRegion(rect) {
  const display = screen.getDisplayMatching(rect);
  const area = intersect(rect, display.bounds);
  if (!area) throw new Error('Capture area is off-screen');

  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
  });
  if (!sources.length) throw new Error('No screen available to capture');

  const displays = screen.getAllDisplays();
  const source =
    sources.find((s) => s.display_id && s.display_id === String(display.id)) ||
    sources[displays.findIndex((d) => d.id === display.id)] ||
    sources[0];

  const full = source.thumbnail;
  const size = full.getSize();
  if (!size.width || !size.height) throw new Error('Screen capture returned an empty image');

  // Map screen points -> thumbnail pixels (thumbnail may not be exactly scaleFactor-sized).
  const kx = size.width / display.bounds.width;
  const ky = size.height / display.bounds.height;
  const crop = {
    x: Math.max(0, Math.round((area.x - display.bounds.x) * kx)),
    y: Math.max(0, Math.round((area.y - display.bounds.y) * ky)),
    width: Math.round(area.width * kx),
    height: Math.round(area.height * ky),
  };
  crop.width = Math.min(crop.width, size.width - crop.x);
  crop.height = Math.min(crop.height, size.height - crop.y);
  if (crop.width < 4 || crop.height < 4) throw new Error('Capture area is too small');

  let img = full.crop(crop);
  const longest = Math.max(crop.width, crop.height);
  if (longest > MAX_SIDE) {
    const k = MAX_SIDE / longest;
    img = img.resize({ width: Math.round(crop.width * k), height: Math.round(crop.height * k), quality: 'best' });
  } else if (longest < MIN_SIDE) {
    const k = Math.min(3, MIN_SIDE / longest);
    img = img.resize({ width: Math.round(crop.width * k), height: Math.round(crop.height * k), quality: 'best' });
  }
  return { base64: img.toPNG().toString('base64'), display };
}

module.exports = { captureRegion };
