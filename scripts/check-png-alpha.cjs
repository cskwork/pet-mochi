const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = path.join(__dirname, '..', 'public', 'sprites');

function readChunks(buf) {
  const out = {};
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    const data = buf.slice(off + 8, off + 8 + len);
    out[type] = (out[type] || []).concat([data]);
    off += 8 + len + 4;
  }
  return out;
}

function corners(rgba, w, h) {
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
  };
  return {
    tl: at(0, 0),
    tr: at(w - 1, 0),
    bl: at(0, h - 1),
    br: at(w - 1, h - 1),
    midTop: at((w / 2) | 0, 0),
    midLeft: at(0, (h / 2) | 0),
  };
}

function alphaHistogram(rgba) {
  const buckets = [0, 0, 0, 0, 0]; // 0, 1-63, 64-191, 192-254, 255
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    if (a === 0) buckets[0]++;
    else if (a < 64) buckets[1]++;
    else if (a < 192) buckets[2]++;
    else if (a < 255) buckets[3]++;
    else buckets[4]++;
  }
  const total = rgba.length / 4;
  return buckets.map((b) => `${((b / total) * 100).toFixed(1)}%`);
}

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.png'))) {
  const full = path.join(dir, f);
  const buf = fs.readFileSync(full);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bit = buf[24];
  const colorType = buf[25];
  console.log(`\n${f} ${w}x${h} bit=${bit} colorType=${colorType} (6=RGBA,2=RGB,3=palette)`);
  if (colorType !== 6 || bit !== 8) {
    console.log('  -> not 8-bit RGBA, skipping pixel sample');
    continue;
  }
  const chunks = readChunks(buf);
  const idatBuf = Buffer.concat(chunks.IDAT);
  let raw;
  try {
    raw = zlib.inflateSync(idatBuf);
  } catch (e) {
    console.log('  -> decompress fail', e.message);
    continue;
  }
  // Filter byte at start of each row, then 4 bytes per pixel.
  const stride = 1 + w * 4;
  // Reconstruct only what we need: row 0 fully, then col 0 of every row, last row, plus simple corners.
  // Simpler: full reconstruct (slow but OK for 1024x1024 -> 1MB).
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * stride];
    const rowSrc = raw.subarray(y * stride + 1, y * stride + 1 + w * 4);
    const rowDst = rgba.subarray(y * w * 4, (y + 1) * w * 4);
    if (filter === 0) {
      rowSrc.copy(rowDst);
    } else if (filter === 1) {
      for (let x = 0; x < rowSrc.length; x++) {
        const left = x >= 4 ? rowDst[x - 4] : 0;
        rowDst[x] = (rowSrc[x] + left) & 0xff;
      }
    } else if (filter === 2) {
      const prev = y === 0 ? null : rgba.subarray((y - 1) * w * 4, y * w * 4);
      for (let x = 0; x < rowSrc.length; x++) {
        const up = prev ? prev[x] : 0;
        rowDst[x] = (rowSrc[x] + up) & 0xff;
      }
    } else if (filter === 3) {
      const prev = y === 0 ? null : rgba.subarray((y - 1) * w * 4, y * w * 4);
      for (let x = 0; x < rowSrc.length; x++) {
        const left = x >= 4 ? rowDst[x - 4] : 0;
        const up = prev ? prev[x] : 0;
        rowDst[x] = (rowSrc[x] + ((left + up) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      const prev = y === 0 ? null : rgba.subarray((y - 1) * w * 4, y * w * 4);
      for (let x = 0; x < rowSrc.length; x++) {
        const a = x >= 4 ? rowDst[x - 4] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= 4 ? prev[x - 4] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        let pred;
        if (pa <= pb && pa <= pc) pred = a;
        else if (pb <= pc) pred = b;
        else pred = c;
        rowDst[x] = (rowSrc[x] + pred) & 0xff;
      }
    } else {
      console.log(`  -> unknown filter ${filter} at row ${y}`);
      break;
    }
  }
  console.log('  corners:', JSON.stringify(corners(rgba, w, h)));
  console.log('  alpha hist [0, 1-63, 64-191, 192-254, 255]:', alphaHistogram(rgba).join(' '));
}
