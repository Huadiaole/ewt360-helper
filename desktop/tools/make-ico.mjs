/**
 * 把若干张 PNG 合成一个多尺寸 .ico（ICO 内嵌 PNG，Vista+ 有效）
 * 用法： node tools/make-ico.mjs <输出.ico> <输入1.png> [输入2.png ...]
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , outPath, ...pngPaths] = process.argv;
if (!outPath || pngPaths.length === 0) {
  console.error('用法: node tools/make-ico.mjs <输出.ico> <png...>');
  process.exit(1);
}

// 从 PNG 的 IHDR 里读宽高（偏移 16 开始是大端 uint32）
function readSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const images = pngPaths
  .map((p) => ({ p, buf: fs.readFileSync(p) }))
  .map((it) => ({ ...it, ...readSize(it.buf) }))
  .sort((a, b) => b.w - a.w);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // reserved
header.writeUInt16LE(1, 2);            // type = icon
header.writeUInt16LE(images.length, 4);

const entries = [];
let offset = 6 + images.length * 16;

for (const img of images) {
  const e = Buffer.alloc(16);
  e[0] = img.w >= 256 ? 0 : img.w;     // 256 用 0 表示
  e[1] = img.h >= 256 ? 0 : img.h;
  e[2] = 0;                             // 调色板数
  e[3] = 0;                             // reserved
  e.writeUInt16LE(1, 4);                // color planes
  e.writeUInt16LE(32, 6);               // bpp
  e.writeUInt32LE(img.buf.length, 8);   // 数据大小
  e.writeUInt32LE(offset, 12);          // 数据偏移
  offset += img.buf.length;
  entries.push(e);
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]));
console.log(
  `已生成 ${outPath}：` + images.map((i) => i.w + 'x' + i.h).join(' / ') +
  ` （${fs.statSync(outPath).size} bytes）`
);
