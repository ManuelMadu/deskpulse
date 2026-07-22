// Generates the menu-bar tray template icons (PDD §13/§16). macOS renders a
// template image as a monochrome mask driven by the alpha channel and ignores
// colour, so the three health states are distinguished by SHAPE, not colour:
//
//   nominal    → a heartbeat "pulse" line
//   degraded   → a warning triangle with a punched-out exclamation
//   agent-down → a ring with a diagonal slash (the universal "off")
//
// Each icon is emitted at 16px (1x) and 32px (2x, "@2x") as black pixels whose
// alpha is the shape coverage, then written as base64 into
// src/main/tray-icons.generated.ts. Run: `node assets/tray/generate.mjs`.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUPERSAMPLE = 4;

// ---- geometry helpers (normalised [0,1] coordinates) ----------------------

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function polylineCoverage(points, halfWidth) {
  return (x, y) => {
    let min = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const d = distToSegment(x, y, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
      if (d < min) min = d;
    }
    return min <= halfWidth;
  };
}

function insideTriangle(x, y, a, b, c) {
  const sign = (p1, p2, p3) =>
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([x, y], a, b);
  const d2 = sign([x, y], b, c);
  const d3 = sign([x, y], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// ---- the three shapes (return coverage 0..1 at a normalised point) ---------

function pulseShape(x, y) {
  const line = polylineCoverage(
    [
      [0.08, 0.52],
      [0.3, 0.52],
      [0.41, 0.22],
      [0.55, 0.8],
      [0.64, 0.4],
      [0.71, 0.52],
      [0.92, 0.52],
    ],
    0.075,
  );
  return line(x, y) ? 1 : 0;
}

function warningShape(x, y) {
  const apex = [0.5, 0.12];
  const bl = [0.1, 0.86];
  const br = [0.9, 0.86];
  if (!insideTriangle(x, y, apex, bl, br)) return 0;
  // Punch out the exclamation mark (transparent → shows the menu-bar colour).
  const barHalf = 0.05;
  const inBar = Math.abs(x - 0.5) <= barHalf && y >= 0.35 && y <= 0.63;
  const inDot = Math.hypot(x - 0.5, y - 0.73) <= 0.055;
  return inBar || inDot ? 0 : 1;
}

function agentDownShape(x, y) {
  const dist = Math.hypot(x - 0.5, y - 0.5);
  const inRing = dist <= 0.37 && dist >= 0.24;
  const onSlash = distToSegment(x, y, 0.27, 0.3, 0.73, 0.7) <= 0.055;
  return inRing || onSlash ? 1 : 0;
}

// ---- rasteriser: shape → RGBA buffer (black, alpha = coverage) -------------

function rasterize(shape, size) {
  const buf = Buffer.alloc(size * size * 4); // RGBA
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          hits += shape(x, y);
        }
      }
      const alpha = Math.round((hits / (SUPERSAMPLE * SUPERSAMPLE)) * 255);
      const i = (py * size + px) * 4;
      buf[i] = 0; // R (black; macOS ignores colour for template images)
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = alpha;
    }
  }
  return buf;
}

// ---- minimal PNG encoder (8-bit RGBA) --------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- emit the generated TS module ------------------------------------------

const shapes = { nominal: pulseShape, degraded: warningShape, agentDown: agentDownShape };
const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', '..', 'src', 'main', 'tray-icons.generated.ts');

const entries = Object.entries(shapes).map(([name, shape]) => {
  const png1x = encodePng(rasterize(shape, 16), 16).toString('base64');
  const png2x = encodePng(rasterize(shape, 32), 32).toString('base64');
  return `  ${name}: {\n    x1: '${png1x}',\n    x2: '${png2x}',\n  },`;
});

const header = `// GENERATED by assets/tray/generate.mjs — do not edit by hand.
// Menu-bar template icons (black + alpha) for the three tray health states,
// base64-encoded PNGs at 16px (x1) and 32px (x2). Embedding sidesteps asar
// path resolution: the icons load identically in dev and the packaged app.

export interface TrayIconPng {
  /** 16px base64 PNG. */
  x1: string;
  /** 32px base64 PNG (Retina @2x). */
  x2: string;
}

export const TRAY_ICONS: Record<'nominal' | 'degraded' | 'agentDown', TrayIconPng> = {
`;

writeFileSync(outPath, `${header}${entries.join('\n')}\n};\n`);
console.log(`wrote ${outPath}`);
