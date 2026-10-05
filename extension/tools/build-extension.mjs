/**
 * 扩展构建器（零依赖，纯 Node）
 *   1. 把 ../ewt360-helper.user.js 合成 content.js（MAIN 世界、document_start 注入）
 *   2. 用内置 PNG 编码器画出 icons/icon16|48|128.png
 *
 * 用法： node tools/build-extension.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const ws = path.resolve(root, '..');

/* ---------------- 1. 生成 content.js ---------------- */
// 用户脚本唯一真源：<repo>/src/ewt360-helper.user.js
const userJsPath = [path.join(ws, 'src', 'ewt360-helper.user.js')].find((p) => fs.existsSync(p));

if (!userJsPath) {
  console.error('找不到用户脚本 ewt360-helper.user.js');
  process.exit(1);
}

let code = fs.readFileSync(userJsPath, 'utf8');
code = code.replace(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/, '');

const content = `/* 由 tools/build-extension.mjs 自动生成，请勿手改 —— 改 ewt360-helper.user.js 后重新构建 */
// 扩展版预设：装好即全开
(function () {
  try {
    window.__EWT_PRESET = Object.assign({}, window.__EWT_PRESET, {
      enabled: true,
      forceSpeed: true,
      speed: 4,
      autoNext: true,
      autoSkip: true,
      autoCheck: true,
      autoResume: true
    });
    window.__EWT_HOST = 'extension';
  } catch (e) {}
})();
${code}
`;

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'content.js'), content, 'utf8');
console.log('content.js 已生成：' + content.length + ' 字符（源：' + path.basename(userJsPath) + '）');

/* ---------------- 2. 内置 PNG 编码器 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 3. 画一只鲸鱼娘（矢量式像素绘制） ---------------- */
const S = 128;
const BG = [43, 143, 214, 255];     // 海洋蓝
const WHITE = [255, 255, 255, 255];
const DARK = [21, 78, 122, 255];    // 眼睛 / 水花

function inRoundRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function shade(x, y) {
  if (!inRoundRect(x + 0.5, y + 0.5, S, S, 26)) return [0, 0, 0, 0];

  const body = ((x - 56) / 38) ** 2 + ((y - 78) / 27) ** 2 <= 1;                  // 身体
  const head = ((x - 30) / 20) ** 2 + ((y - 70) / 18) ** 2 <= 1;                  // 脑门
  const tail = x >= 88 && x <= 122 && Math.abs(y - 78) <= (122 - x) * 0.62;       // 尾鳍
  const fin = ((x - 60) / 16) ** 2 + ((y - 100) / 11) ** 2 <= 1 && y >= 92;       // 胸鳍
  const belly = body && y > 80;

  let col = null;
  if (tail || body || head || fin) col = WHITE.slice();
  if (belly) col = [214, 238, 252, 255];

  // 眼睛
  if (((x - 26) / 5) ** 2 + ((y - 68) / 5) ** 2 <= 1) col = DARK.slice();
  // 喷水
  if (y >= 30 && y <= 44 && Math.abs(x - 40) <= 2) col = WHITE.slice();
  if (y >= 26 && y <= 34 && Math.abs(x - 50) <= 2) col = WHITE.slice();

  return col || BG.slice();
}

function icon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = S / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 盒式降采样，缩小时不至于糊成一团
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * scale), x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      const y0 = Math.floor(y * scale), y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const c = shade(Math.min(sx, S - 1), Math.min(sy, S - 1));
          r += c[0]; g += c[1]; b += c[2]; a += c[3]; n++;
        }
      }
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, size, buf);
}

const iconDir = path.join(root, 'icons');
fs.mkdirSync(iconDir, { recursive: true });

// 图标由 ../tools/make-icons.ps1 从 docs/icon-source.jpg 生成（四种形态共用一套）。
// 这里只在「缺图标」时才用内置的鲸鱼占位图兜底，避免把用户换的图标覆盖掉。
const needIcons = [16, 48, 128].some((s) => !fs.existsSync(path.join(iconDir, `icon${s}.png`)));
if (needIcons) {
  for (const s of [16, 48, 128, 256]) {
    const file = path.join(iconDir, `icon${s}.png`);
    fs.writeFileSync(file, icon(s));
    console.log('图标缺失，已生成占位图：icons/icon' + s + '.png');
  }
  console.log('提示：想换成自己的图，请跑  pwsh -File tools\\make-icons.ps1');
} else {
  console.log('图标已存在，跳过（要重新生成：pwsh -File tools\\make-icons.ps1）');
}
console.log('全部完成 ✅');
