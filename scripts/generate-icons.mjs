// Writes extension/icons/icon{16,32,48,128}.png (indigo rounded square with a
// white play triangle). No dependencies: raw RGBA → PNG with node:zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../extension/icons/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size) {
  const ss = 4; // supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss;
          const fy = y + (sy + 0.5) / ss;
          const dx = Math.max(r - fx, fx - (size - r), 0);
          const dy = Math.max(r - fy, fy - (size - r), 0);
          if (dx * dx + dy * dy <= r * r) {
            bg++;
            // Play triangle: (0.36,0.26) (0.36,0.74) (0.76,0.5)
            const u = fx / size;
            const v = fy / size;
            if (u >= 0.36 && u <= 0.76 && Math.abs(v - 0.5) <= 0.24 * (0.76 - u) / 0.4) fg++;
          }
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const a = bg / n;
      const f = bg ? fg / bg : 0;
      px[i] = Math.round(67 + (255 - 67) * f);
      px[i + 1] = Math.round(56 + (255 - 56) * f);
      px[i + 2] = Math.round(202 + (255 - 202) * f);
      px[i + 3] = Math.round(255 * a);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [16, 32, 48, 128]) writeFileSync(`${outDir}icon${s}.png`, icon(s));
console.log('icons written to', outDir);
