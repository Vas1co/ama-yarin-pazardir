// Tek seferlik marka dönüşümü: İmalat Masası -> Ama Yarın Pazardır (metin, alan adı, logo, font, renk).
// Tekrar çalıştırmak güvenlidir (zaten dönüşmüş metinde eşleşme bulmaz).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ALAN = 'ama-yarin-pazardir.peekdock.com';
const EPOSTA = 'iletisim@peekdock.com';

const ESKI_LOGO = /<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="8" fill="var\(--accent\)"\/><path d="M8 24h9V10h9"[^]*?<\/svg>/g;
export const YENI_LOGO = '<svg viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="9" fill="var(--accent)"/>'
  + '<path d="M16 7c.8 5.6 3.9 8.7 9.5 9.5-5.6.8-8.7 3.9-9.5 9.5-.8-5.6-3.9-8.7-9.5-9.5 5.6-.8 8.7-3.9 9.5-9.5z" fill="#fff"/>'
  + '<circle cx="26.5" cy="8" r="2" fill="#89dceb"/></svg>';

const ESKI_FONT = 'family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500';
const YENI_FONT = 'family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500';

// Sırası önemli: önce özel durumlar.
const KURALLAR = [
  [/"email":"iletisim@imalatmasasi\.com",?/g, ''],
  [/,?"sameAs":\["https:\/\/www\.instagram\.com\/imalatmasasi\/"\]/g, ''],
  [/<p><a class="sosyal" href="https:\/\/www\.instagram\.com\/imalatmasasi\/"[^]*?<\/a><\/p>/g, ''],
  [/<meta name="google-adsense-account" content="ca-pub-\d+">\n?/g, ''],
  [/iletisim@imalatmasasi\.com/g, EPOSTA],
  [/İmalat Masası'nda/g, "Ama Yarın Pazardır'da"],
  [/İmalat Masası/g, 'Ama Yarın Pazardır'],
  [/İMALAT MASASI/g, 'AMA YARIN PAZARDIR'],
  [/imalatmasasi\.com/g, ALAN],
  [ESKI_LOGO, YENI_LOGO],
  [ESKI_FONT, YENI_FONT],
  [/content="#c2561a"/g, 'content="#1638d4"'],
];

// Sıkıştırılmış JS içinde sabit yazılmış renkler (PDF/PNG rapor çizimleri, DXF önizleme).
const JS_RENK = {
  '#c2561a': '#1638d4', '#f8dcc9': '#dfe8ff', '#ffe8d9': '#e3ecff', '#f2c9ad': '#c9d7ff', '#16242c': '#0b0f17',
  '#6b7b85': '#5a6b8c', '#f4f7f8': '#f4f8ff', '#c9dbe5': '#e3ecff',
  // parça paleti (açık tonlar): peekdock vurguları
  '#7fb2c9': '#8ea0f0', '#e2a47c': '#ffa48f', '#9fc287': '#7fdcb5', '#c7a1d2': '#c4b2fb', '#d9c56e': '#ffd27f', '#8fc4bf': '#a3e3ee',
};

let toplam = 0;
for (const ad of fs.readdirSync(KOK)) {
  if (!/\.(html|js|xml|txt|webmanifest)$/.test(ad)) continue;
  const yol = path.join(KOK, ad);
  let metin = fs.readFileSync(yol, 'utf8');
  const once = metin;
  for (const [a, b] of KURALLAR) metin = metin.replace(a, b);
  if (ad.endsWith('.js')) for (const [a, b] of Object.entries(JS_RENK)) metin = metin.split(a).join(b);
  if (metin !== once) { fs.writeFileSync(yol, metin); toplam++; }
}

// ayarlar.js: eski AdSense numarası temizlenir
const ay = path.join(KOK, 'ayarlar.js');
fs.writeFileSync(ay, fs.readFileSync(ay, 'utf8').replace(/client: 'ca-pub-\d+'/, "client: ''"));
// ads.txt eski yayıncıya aitti
fs.rmSync(path.join(KOK, 'ads.txt'), { force: true });
// manifest renkleri
const mf = path.join(KOK, 'site.webmanifest');
fs.writeFileSync(mf, fs.readFileSync(mf, 'utf8').replace('#f4f1ec', '#f4f8ff').replace('#c2561a', '#1638d4'));

console.log(`Değişen dosya: ${toplam}`);
