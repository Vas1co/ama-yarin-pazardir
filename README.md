# Ama Yarın Pazardır

Sac açılım, profil boy kesim, DXF sac yerleşimi (nesting), ağırlık ve dişli hesap araçları.
Tamamen statik site; tüm hesaplar tarayıcıda yapılır, sunucu tarafı kod yoktur.

- Yayın adresi: **https://ama-yarin-pazardir.peekdock.com**
- Sürüm: 1.8.1 (kod tabanı), tema: peekdock renk skalası

## Klasör yapısı

| Yol | İçerik |
|---|---|
| `public/` | Yayına giden site (Cloudflare Pages çıktı klasörü). |
| `public/*.html` | 108 sayfa: ana sayfa, 7 ana araç, SEO sayfaları, 26 `rehber-*` yazısı, yasal sayfalar, 403/404/500 |
| `public/ayarlar.js` | Site ayarları (sürüm, AdSense, geçiş reklamı) — elle düzenlenebilir |
| `public/ortak.js` | Tüm sayfalarda ortak kod (sıkıştırılmış) |
| `public/cekirdek.js` | Hesap motoru: açılımlar, ağırlık, dişli, DXF/ZIP üretimi (sıkıştırılmış) |
| `public/uygulama.js` | Arayüz kodu, PDF/PNG rapor çizimi (sıkıştırılmış) |
| `public/isci.js` | Web Worker — nesting / yerleşim hesapları |
| `public/stil.css` | Tüm stiller; renkler en üstteki `:root` değişkenlerinde (açık + koyu tema) |
| `public/og/`, `public/blog/` | Sosyal paylaşım görselleri ve rehber çizimleri |
| `public/_headers` | Cloudflare Pages güvenlik başlıkları (CSP vb.) |
| `kaynak-okunur/` | Sıkıştırılmış JS/CSS'in Prettier ile biçimlendirilmiş, **okunabilir** kopyaları (yalnızca okuma için) |
| `araclar/` | Marka/görsel dönüşüm betikleri (aşağıda) |
| `sunucu.mjs` | Bağımlılıksız yerel sunucu (temiz URL'ler + 404 sayfası, Cloudflare Pages gibi) |

## Çalıştırma

```bash
npm run dev
```

http://localhost:8080

## Yayına alma (Cloudflare Pages + peekdock.com alt alan adı)

1. Cloudflare panosu → **Workers & Pages → Create → Pages → Connect to Git** → `Vas1co/ama-yarin-pazardir`
   - Framework: *None*, Build command: *(boş)*, Build output directory: **`public`**
2. Proje → **Custom domains → Set up a custom domain** → `ama-yarin-pazardir.peekdock.com`
   - peekdock.com aynı Cloudflare hesabındaysa CNAME kaydı ve SSL sertifikası otomatik oluşur.
3. SSL/TLS → mod **Full (strict)**; *Always Use HTTPS* açık.

Alternatif (Git bağlantısı olmadan, elle): `npx wrangler login` ardından `npm run deploy`.

## Marka ve tema değişikliği (İmalat Masası → Ama Yarın Pazardır)

Kod tabanı imalatmasasi.com'un yayındaki dosyalarından geri kazanıldı ve yeniden markalandı:

- `araclar/markala.mjs` — metin/alan adı/logo/font/tema rengi dönüşümü; eski AdSense numarası, `ads.txt`
  ve Instagram bağlantıları kaldırıldı. İletişim e-postası: `iletisim@peekdock.com`.
- `araclar/og-listesi.mjs` + `araclar/gorseller.ps1` — OG görselleri, rehber çizimleri ve ikonlar
  (Windows'ta `powershell -ExecutionPolicy Bypass -File araclar\gorseller.ps1`). Betik turuncu kaynak
  görseller için yazıldı; tekrar çalıştırmak gerekirse önce orijinal görseller geri konmalı.
- Tema: peekdock paleti — zemin `#f4f8ff`, eylem rengi kobalt `#1638d4`, metin `#0b0f17`,
  ikincil `#5a6b8c`, vurgular camgöbeği `#89dceb` ve mor `#a78bfa`; font Plus Jakarta Sans.

## Bilinmesi gerekenler

- **Orijinal değişken adları yok.** Yayındaki JS sıkıştırılmıştı ve kaynak haritası yoktu. Değişiklikleri
  `public/` içindeki dosyalarda yapın; `kaynak-okunur/` yalnızca anlamak içindir.
- **Şablon/derleme adımı yok.** 108 HTML sayfası bağımsız dosyalardır — menü, alt bilgi gibi ortak
  değişiklikler tüm dosyalarda (toplu bul-değiştir) yapılmalı.
- JS/CSS değiştirince HTML'lerdeki `?v=1.8.1` sürüm parametresini toplu artırın (önbellek).
- Arama motoru kaydı (Search Console vb.) yapılmadı. `robots.txt` indekslemeye açık; sitemap yeni alan
  adını gösteriyor.
