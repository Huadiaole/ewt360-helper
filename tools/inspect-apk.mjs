/**
 * APK 验收器（零依赖，纯 Node）
 *   - 解析 zip 中央目录，列出内容
 *   - 抽出 assets/ewt360-helper.user.js 与源文件比对哈希
 *   - 检查 classes.dex / resources.arsc / AndroidManifest.xml / 图标是否齐全
 *
 * 用法： node tools/inspect-apk.mjs [apk路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ws = path.resolve(here, '..');
// 不传参数就自动挑 dist/ 里最新的那个 APK
const defaultApk = (() => {
  const dir = path.join(ws, 'dist');
  if (!fs.existsSync(dir)) return path.join(dir, 'EWT360-Helper-debug.apk');
  const apks = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.apk')).sort();
  return apks.length ? path.join(dir, apks[apks.length - 1]) : path.join(dir, 'EWT360-Helper-debug.apk');
})();
const apkPath = process.argv[2] || defaultApk;
const srcJs = path.join(ws, 'src', 'ewt360-helper.user.js');

if (!fs.existsSync(apkPath)) {
  console.error('找不到 APK：' + apkPath);
  process.exit(2);
}

const buf = fs.readFileSync(apkPath);

/* ---------- 解析 zip 中央目录 ---------- */
function readCentralDirectory(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）');
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) break;
    const method = b.readUInt16LE(off + 10);
    const compSize = b.readUInt32LE(off + 20);
    const rawSize = b.readUInt32LE(off + 24);
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    const localOff = b.readUInt32LE(off + 42);
    const name = b.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, rawSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(b, e) {
  const nameLen = b.readUInt16LE(e.localOff + 26);
  const extraLen = b.readUInt16LE(e.localOff + 28);
  const dataStart = e.localOff + 30 + nameLen + extraLen;
  const raw = b.subarray(dataStart, dataStart + e.compSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('不支持的压缩方式: ' + e.method + ' (' + e.name + ')');
}

const entries = readCentralDirectory(buf);
const byName = new Map(entries.map((e) => [e.name, e]));
const hm = (b) => crypto.createHash('sha256').update(b).digest('hex');

console.log('=== APK: ' + path.basename(apkPath) + ' ===');
console.log('大小: ' + (buf.length / 1048576).toFixed(2) + ' MB  |  条目数: ' + entries.length + '\n');

/* ---------- 关键文件 ---------- */
console.log('--- 关键文件 ---');
const required = [
  ['AndroidManifest.xml', true],
  ['classes.dex', true],
  ['resources.arsc', true],
  ['assets/ewt360-helper.user.js', true]
];
let ok = true;
for (const [name] of required) {
  const e = byName.get(name);
  if (e) console.log(`  ✅ ${name.padEnd(32)} ${e.rawSize.toLocaleString()} B  (压缩后 ${e.compSize.toLocaleString()} B)`);
  else { console.log(`  ❌ ${name.padEnd(32)} 缺失`); ok = false; }
}

/* ---------- 图标 ---------- */
console.log('\n--- 图标 ---');
const icons = entries.filter((e) => /ic_launcher/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
if (icons.length === 0) { console.log('  ❌ 一个都没有'); ok = false; }
for (const e of icons) console.log(`  ${e.name.padEnd(52)} ${e.rawSize.toLocaleString().padStart(8)} B`);

/* ---------- assets 脚本比对 ---------- */
console.log('\n--- assets 里的用户脚本 ---');
const jsEntry = byName.get('assets/ewt360-helper.user.js');
if (jsEntry) {
  const apkJs = extract(buf, jsEntry).toString('utf8');
  const srcText = fs.readFileSync(srcJs, 'utf8');
  const same = hm(Buffer.from(apkJs, 'utf8')) === hm(Buffer.from(srcText, 'utf8'));
  console.log('  APK 内 SHA256 : ' + hm(Buffer.from(apkJs, 'utf8')).slice(0, 32));
  console.log('  源文件 SHA256 : ' + hm(Buffer.from(srcText, 'utf8')).slice(0, 32));
  console.log('  完全一致      : ' + (same ? '✅ 是' : '❌ 否'));
  console.log('  行数          : ' + apkJs.split('\n').length);
  console.log('  含 ForceSpeed : ' + apkJs.includes('ForceSpeed'));
  console.log('  含 isTrusted  : ' + apkJs.includes('isTrusted'));
  console.log('  含 CHECK_HIT  : ' + apkJs.includes('CHECK_HIT'));
  if (!same) ok = false;
}

/* ---------- dex / arsc 体积提示 ---------- */
const dex = entries.filter((e) => /^classes\d*\.dex$/.test(e.name));
console.log('\n--- dex ---');
dex.forEach((e) => console.log(`  ${e.name}  ${e.rawSize.toLocaleString()} B`));

console.log('\n结论: ' + (ok ? '✅ APK 结构完整、脚本一致' : '❌ 有问题，见上面标红项'));
process.exit(ok ? 0 : 1);
