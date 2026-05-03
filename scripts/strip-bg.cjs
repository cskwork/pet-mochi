// Replace the connected background of each sprite PNG with alpha=0.
// gpt-image-1 (via codex-cli) emits an opaque RGB canvas — usually white but
// occasionally a light grey card. We auto-detect the background colour by
// sampling the corners, then flood-fill any pixel within TOLERANCE of that
// colour from the edges.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DIR = path.join(__dirname, '..', 'public', 'sprites');
const TOLERANCE = 28;     // max per-channel distance from detected bg colour
const FRINGE_BAND = 2;    // pixels of soft alpha fade at boundary

function detectBackground(data, w, h) {
  // Sample many points along all 4 edges, take median per channel.
  const samples = [];
  const N = 32;
  const push = (x, y) => {
    const o = (y * w + x) * 4;
    samples.push([data[o], data[o + 1], data[o + 2]]);
  };
  for (let i = 0; i < N; i++) {
    const x = Math.round(((w - 1) * i) / (N - 1));
    push(x, 0);
    push(x, h - 1);
    const y = Math.round(((h - 1) * i) / (N - 1));
    push(0, y);
    push(w - 1, y);
  }
  const sortBy = (k) => samples.map((s) => s[k]).sort((a, b) => a - b);
  const median = (arr) => arr[arr.length >> 1];
  return [median(sortBy(0)), median(sortBy(1)), median(sortBy(2))];
}

function processFile(file) {
  const buf = fs.readFileSync(path.join(DIR, file));
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;
  const [bgR, bgG, bgB] = detectBackground(data, w, h);

  const matches = (r, g, b) =>
    Math.abs(r - bgR) <= TOLERANCE &&
    Math.abs(g - bgG) <= TOLERANCE &&
    Math.abs(b - bgB) <= TOLERANCE;

  const visited = new Uint8Array(w * h);
  const stack = [];

  function seed(x, y) {
    const i = y * w + x;
    if (visited[i]) return;
    const o = i * 4;
    if (matches(data[o], data[o + 1], data[o + 2])) {
      visited[i] = 1;
      stack.push(i);
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (stack.length > 0) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;
    const tryNeighbour = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const ni = ny * w + nx;
      if (visited[ni]) return;
      const no = ni * 4;
      if (matches(data[no], data[no + 1], data[no + 2])) {
        visited[ni] = 1;
        stack.push(ni);
      }
    };
    tryNeighbour(x - 1, y);
    tryNeighbour(x + 1, y);
    tryNeighbour(x, y - 1);
    tryNeighbour(x, y + 1);
  }

  let cleared = 0;
  for (let i = 0; i < visited.length; i++) {
    if (visited[i]) {
      data[i * 4 + 3] = 0;
      cleared++;
    } else {
      // Force opaque on non-background; the script may run twice, and
      // pre-existing partial alpha from a previous fringe pass should reset
      // before we recompute the fringe.
      data[i * 4 + 3] = 255;
    }
  }

  if (FRINGE_BAND > 0) {
    const neighbourTransparent = (x, y) => {
      for (let dy = -FRINGE_BAND; dy <= FRINGE_BAND; dy++) {
        for (let dx = -FRINGE_BAND; dx <= FRINGE_BAND; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni]) {
            return Math.max(Math.abs(dx), Math.abs(dy));
          }
        }
      }
      return 0;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (visited[i]) continue;
        const dist = neighbourTransparent(x, y);
        if (dist > 0) {
          const fade = 180 + Math.round(((dist - 1) / Math.max(1, FRINGE_BAND - 1)) * 60);
          const o = i * 4;
          if (data[o + 3] > fade) data[o + 3] = fade;
        }
      }
    }
  }

  png.colorType = 6;
  const out = PNG.sync.write(png, { colorType: 6 });
  fs.writeFileSync(path.join(DIR, file), out);
  console.log(
    `${file}: bg=(${bgR},${bgG},${bgB}) cleared ${cleared}/${w * h} (${(
      (cleared / (w * h)) * 100
    ).toFixed(1)}%)`,
  );
}

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.png'))
  .sort();

for (const f of files) processFile(f);
console.log('done');
