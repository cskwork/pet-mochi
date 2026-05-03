// Generates icons/source.png — a 512x512 mochi pet icon — using only Node built-ins.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "../src-tauri/icons");
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, "source.png");

const W = 512;
const H = 512;

// CRC table per PNG spec
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcVal]);
}

// Build pixel data — round mochi shape with face.
const stride = W * 4;
const raw = Buffer.alloc(H * (stride + 1));

const cx = W / 2;
const cy = H / 2;
const bodyR = W * 0.42;

function setPixel(x, y, r, g, b, a) {
  const o = y * (stride + 1) + 1 + x * 4;
  raw[o] = r;
  raw[o + 1] = g;
  raw[o + 2] = b;
  raw[o + 3] = a;
}

for (let y = 0; y < H; y++) {
  raw[y * (stride + 1)] = 0; // filter byte
  for (let x = 0; x < W; x++) {
    const dx = x - cx;
    const dy = y - cy + 18;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Body — soft pink mochi, with slight gradient.
    if (dist < bodyR) {
      const t = dist / bodyR;
      const r = Math.round(255 - t * 12);
      const g = Math.round(216 - t * 30);
      const b = Math.round(225 - t * 18);
      setPixel(x, y, r, g, b, 255);

      // Cheeks
      const cheekL = Math.hypot(x - (cx - 95), y - (cy + 18));
      const cheekR = Math.hypot(x - (cx + 95), y - (cy + 18));
      if (cheekL < 38) setPixel(x, y, 255, 168, 192, 255);
      if (cheekR < 38) setPixel(x, y, 255, 168, 192, 255);

      // Eyes
      const eyeL = Math.hypot(x - (cx - 60), y - (cy - 18));
      const eyeR = Math.hypot(x - (cx + 60), y - (cy - 18));
      if (eyeL < 18) setPixel(x, y, 50, 32, 48, 255);
      if (eyeR < 18) setPixel(x, y, 50, 32, 48, 255);

      // Mouth — small smile
      if (y > cy + 30 && y < cy + 60) {
        const mx = x - cx;
        const my = y - (cy + 35);
        if (Math.abs(mx) < 30 && my > 0 && my < 12 && Math.abs(my - mx * mx / 90) < 4) {
          setPixel(x, y, 70, 40, 60, 255);
        }
      }
    } else {
      // transparent background
      setPixel(x, y, 0, 0, 0, 0);
    }
  }
}

const idat = deflateSync(raw, { level: 9 });

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(outFile, png);
console.log(`wrote ${outFile} (${png.length} bytes)`);
