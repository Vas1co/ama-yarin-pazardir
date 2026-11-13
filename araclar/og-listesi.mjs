// OG görselleri için iş listesi üretir: dosya \t üst etiket \t başlık  (araclar/gorseller.ps1 bunu okur)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const OZEL = { 'ana-agirlik': 'AĞIRLIK HESABI', 'ana-atolye': 'ATÖLYE HESAPLARI', 'ana-boru': 'SAC AÇILIM VE BORU',
  'ana-disli': 'DİŞLİ HESABI', 'ana-profil': 'PROFİL BOY KESİM', 'ana-sac': 'SAC YERLEŞİM', 'ana-vida': 'VİDA VE KAMA' };
function etiket(ad) {
  if (OZEL[ad]) return OZEL[ad];
  if (/agirli/.test(ad)) return 'AĞIRLIK HESABI';
  if (/disli|kremayer|modul/.test(ad)) return 'DİŞLİ HESABI';
  if (/yerles|nesting|sac-fire|lazer|plazma/.test(ad)) return 'SAC YERLEŞİM';
  if (/kesim|fire|testere|cutting/.test(ad)) return 'PROFİL BOY KESİM';
  if (/vida|dis-|disi|kama|kilavuz|somun|bsp|whitworth/.test(ad)) return 'VİDA VE KAMA';
  if (/atolye/.test(ad)) return 'ATÖLYE HESAPLARI';
  return 'SAC AÇILIM VE BORU';
}

const satirlar = [];
const gorulen = new Set();
for (const f of fs.readdirSync(KOK).filter(f => f.endsWith('.html')).sort()) {
  const h = fs.readFileSync(path.join(KOK, f), 'utf8');
  const og = (h.match(/property="og:image" content="[^"]*\/og\/([^"]+)"/) || [])[1];
  if (!og || og === 'site.jpg' || gorulen.has(og)) continue;
  gorulen.add(og);
  let t = (h.match(/property="og:title" content="([^"]+)"/) || [])[1] || '';
  t = t.split(' | ')[0].split(' – ')[0].split(': ')[0].trim();
  satirlar.push([og, etiket(og.replace(/\.jpg$/, '')), t].join('\t'));
}
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'og-listesi.tsv'), satirlar.join('\n'), 'utf8');
console.log(satirlar.length + ' OG görseli');
