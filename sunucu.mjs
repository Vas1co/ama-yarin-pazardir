// Bağımlılıksız yerel geliştirme sunucusu. Cloudflare Pages davranışını taklit eder:
//   /sayfa  -> public/sayfa.html   |   /sayfa.html -> 307 /sayfa   |   bulunamazsa public/404.html (404)
// Kullanım: node sunucu.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.argv[2]) || 8080;
const TIPLER = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

// _headers dosyasındaki genel (/*) başlıkları yerelde de uygula; HSTS ve upgrade-insecure-requests http'de sorun çıkarır, atlanır.
const genelBasliklar = {};
try {
  let aktif = false;
  for (const satir of fs.readFileSync(path.join(KOK, '_headers'), 'utf8').split(/\r?\n/)) {
    if (!satir.trim() || satir.startsWith('#')) continue;
    if (!/^\s/.test(satir)) { aktif = satir.trim() === '/*'; continue; }
    if (!aktif) continue;
    const i = satir.indexOf(':');
    const ad = satir.slice(0, i).trim(); let deger = satir.slice(i + 1).trim();
    if (ad === 'Strict-Transport-Security') continue;
    if (ad === 'Content-Security-Policy') deger = deger.replace(/;\s*upgrade-insecure-requests/, '');
    genelBasliklar[ad] = deger;
  }
} catch {}

function gonder(res, durum, dosya) {
  res.writeHead(durum, { ...genelBasliklar, 'Content-Type': TIPLER[path.extname(dosya).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(dosya).pipe(res);
}

http.createServer((req, res) => {
  let yol;
  try { yol = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (yol.split('/').some(p => p === '..' || p.startsWith('_'))) { gonder(res, 404, path.join(KOK, '404.html')); return; }

  if (yol.endsWith('.html')) {
    const temiz = yol === '/index.html' ? '/' : yol.slice(0, -5);
    res.writeHead(307, { Location: temiz }).end(); return;
  }
  const adaylar = yol.endsWith('/') ? [path.join(KOK, yol, 'index.html')] : [path.join(KOK, yol), path.join(KOK, yol + '.html')];
  for (const a of adaylar) {
    if (fs.existsSync(a) && fs.statSync(a).isFile()) { gonder(res, 200, a); return; }
  }
  gonder(res, 404, path.join(KOK, '404.html'));
}).listen(PORT, () => console.log(`İmalat Masası yerel: http://localhost:${PORT}`));
