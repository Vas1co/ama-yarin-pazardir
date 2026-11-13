/* Sac Atölyesi çekirdeği: bağımlılıksız, tarayıcıda (worker dahil) ve node'da çalışır.
 *  - Sacdan boru açılımı (rulo) ve DXF yazımı
 *  - Profil boy kesim optimizasyonu
 *  - DXF okuma (LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, SPLINE, ELLIPSE, INSERT)
 *  - Sac yerleşimi (nesting)
 *  - ZIP (sıkıştırmasız) yazımı
 */
(function (root) {
  "use strict";

  class GirdiHatasi extends Error {
    constructor(m) {
      super(m);
      this.kullanici = true;
    }
  }

  const SAG_MM = 0.15; // yay/daire düzleştirme toleransı (mm)
  const BIRLESTIRME_MM = 0.05; // uç noktaları bağlama toleransı (mm)
  const MAX_VARLIK = 20000;
  const MAX_DOSYA_KARAKTER = 8 * 1024 * 1024;
  const MAX_TOPLAM_PARCA = 300;
  const BIRIM_CARPANI = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 9: 0.0254, 10: 914.4 };

  const TR = {
    ç: "c",
    Ç: "C",
    ğ: "g",
    Ğ: "G",
    ı: "i",
    İ: "I",
    ö: "o",
    Ö: "O",
    ş: "s",
    Ş: "S",
    ü: "u",
    Ü: "U",
  };
  function ascii(s) {
    return String(s)
      .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR[c])
      .replace(/[^\x20-\x7e]/g, "?");
  }

  // =====================================================================
  //  DXF YAZMA (R12, her CAD yazılımının açabildiği sade biçim)
  // =====================================================================
  function sayi(n) {
    const t = Number(n).toFixed(4);
    return t.indexOf(".") >= 0 ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
  }

  function dxfYaz(katmanlar, varliklar) {
    const o = [];
    const p = (k, v) => {
      o.push(String(k));
      o.push(String(v));
    };
    p(0, "SECTION");
    p(2, "HEADER");
    p(9, "$ACADVER");
    p(1, "AC1009");
    p(9, "$INSUNITS");
    p(70, 4);
    p(0, "ENDSEC");
    p(0, "SECTION");
    p(2, "TABLES");
    p(0, "TABLE");
    p(2, "LTYPE");
    p(70, 2);
    p(0, "LTYPE");
    p(2, "CONTINUOUS");
    p(70, 0);
    p(3, "Solid line");
    p(72, 65);
    p(73, 0);
    p(40, 0.0);
    p(0, "LTYPE");
    p(2, "DASHED");
    p(70, 0);
    p(3, "Dashed");
    p(72, 65);
    p(73, 2);
    p(40, 15.0);
    p(49, 10.0);
    p(49, -5.0);
    p(0, "ENDTAB");
    p(0, "TABLE");
    p(2, "LAYER");
    p(70, katmanlar.length);
    for (const k of katmanlar) {
      p(0, "LAYER");
      p(2, k.ad);
      p(70, 0);
      p(62, k.renk);
      p(6, k.cizgi || "CONTINUOUS");
    }
    p(0, "ENDTAB");
    p(0, "ENDSEC");
    p(0, "SECTION");
    p(2, "ENTITIES");
    for (const e of varliklar) {
      if (e.t === "poly") {
        p(0, "POLYLINE");
        p(8, e.katman);
        p(66, 1);
        p(10, 0);
        p(20, 0);
        p(30, 0);
        p(70, e.kapali ? 1 : 0);
        for (const q of e.pts) {
          p(0, "VERTEX");
          p(8, e.katman);
          p(10, sayi(q[0]));
          p(20, sayi(q[1]));
          p(30, 0);
        }
        p(0, "SEQEND");
        p(8, e.katman);
      } else if (e.t === "line") {
        p(0, "LINE");
        p(8, e.katman);
        p(10, sayi(e.x1));
        p(20, sayi(e.y1));
        p(30, 0);
        p(11, sayi(e.x2));
        p(21, sayi(e.y2));
        p(31, 0);
      } else if (e.t === "arc") {
        p(0, "ARC");
        p(8, e.katman);
        p(10, sayi(e.cx));
        p(20, sayi(e.cy));
        p(30, 0);
        p(40, sayi(e.r));
        p(50, sayi(e.a0));
        p(51, sayi(e.a1));
      } else if (e.t === "text") {
        p(0, "TEXT");
        p(8, e.katman);
        p(10, sayi(e.x));
        p(20, sayi(e.y));
        p(30, 0);
        p(40, sayi(e.h));
        p(1, ascii(e.metin));
        if (e.aci) p(50, sayi(e.aci));
      }
    }
    p(0, "ENDSEC");
    p(0, "EOF");
    return o.join("\n") + "\n";
  }

  // =====================================================================
  //  ZIP (sıkıştırmasız)
  // =====================================================================
  let CRC_TABLO = null;
  function crc32(u8) {
    if (!CRC_TABLO) {
      CRC_TABLO = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLO[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLO[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipYap(dosyaAdi, metin) {
    const ad = new TextEncoder().encode(dosyaAdi);
    const veri = new TextEncoder().encode(metin);
    const crc = crc32(veri);
    const yerel = 30 + ad.length,
      merkez = 46 + ad.length;
    const toplam = yerel + veri.length + merkez + 22;
    const buf = new ArrayBuffer(toplam),
      v = new DataView(buf),
      u = new Uint8Array(buf);
    let o = 0;
    v.setUint32(o, 0x04034b50, true);
    o += 4;
    v.setUint16(o, 20, true);
    o += 2;
    v.setUint16(o, 0x0800, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0x21, true);
    o += 2;
    v.setUint32(o, crc, true);
    o += 4;
    v.setUint32(o, veri.length, true);
    o += 4;
    v.setUint32(o, veri.length, true);
    o += 4;
    v.setUint16(o, ad.length, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    u.set(ad, o);
    o += ad.length;
    u.set(veri, o);
    o += veri.length;
    const merkezBaslangic = o;
    v.setUint32(o, 0x02014b50, true);
    o += 4;
    v.setUint16(o, 20, true);
    o += 2;
    v.setUint16(o, 20, true);
    o += 2;
    v.setUint16(o, 0x0800, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0x21, true);
    o += 2;
    v.setUint32(o, crc, true);
    o += 4;
    v.setUint32(o, veri.length, true);
    o += 4;
    v.setUint32(o, veri.length, true);
    o += 4;
    v.setUint16(o, ad.length, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint32(o, 0, true);
    o += 4;
    v.setUint32(o, 0, true);
    o += 4;
    u.set(ad, o);
    o += ad.length;
    v.setUint32(o, 0x06054b50, true);
    o += 4;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 0, true);
    o += 2;
    v.setUint16(o, 1, true);
    o += 2;
    v.setUint16(o, 1, true);
    o += 2;
    v.setUint32(o, merkez, true);
    o += 4;
    v.setUint32(o, merkezBaslangic, true);
    o += 4;
    v.setUint16(o, 0, true);
    o += 2;
    return u;
  }

  // =====================================================================
  //  BORU AÇILIMI: yuvarlak (rulo), kare/dikdörtgen (abkant), çokgen (abkant), konik (rulo)
  // =====================================================================
  const YOGUNLUK = { celik: 7.85, paslanmaz: 7.93, aluminyum: 2.7 };
  const BORU_TIPLERI = ["yuvarlak", "kare", "cokgen", "konik"];

  function pz(v, ad) {
    if (!(v > 0)) throw new GirdiHatasi(ad + " 0'dan büyük olmalı.");
    return v;
  }

  function boruModel(g) {
    const tip = g.tip || "yuvarlak";
    if (BORU_TIPLERI.indexOf(tip) < 0) throw new GirdiHatasi("Bilinmeyen boru tipi.");
    const et = +g.et;
    const k = g.k === undefined || g.k === "" || g.k === null ? 0.5 : +g.k;
    const kaynak = +(g.kaynak || 0);
    const malzeme = YOGUNLUK[g.malzeme] ? g.malzeme : "celik";
    pz(et, "Sac kalınlığı");
    if (!(k >= 0.2 && k <= 0.5)) throw new GirdiHatasi("K faktörü 0,2 ile 0,5 arasında olmalı.");
    if (!(kaynak >= 0)) throw new GirdiHatasi("Kaynak aralığı negatif olamaz.");
    const m = { tip, et, k, kaynak, malzeme, uyarilar: [], segs: [], cizgiler: [], onCizgiler: [] };

    if (tip === "yuvarlak") {
      const dis = pz(+g.dis, "Dış çap"),
        boy = pz(+g.boy, "Boru boyu");
      const dilim = g.dilim === undefined || g.dilim === "" ? 4 : Math.round(+g.dilim);
      const onBukum = +(g.onBukum || 0);
      if (dis <= 2 * et) throw new GirdiHatasi("Dış çap, sac kalınlığının iki katından büyük olmalı.");
      if (!(dilim >= 1 && dilim <= 36)) throw new GirdiHatasi("Dilim sayısı 1 ile 36 arasında olmalı.");
      if (!(onBukum >= 0)) throw new GirdiHatasi("Ön büküm payı negatif olamaz.");
      const ic = dis - 2 * et,
        notr = ic + 2 * k * et,
        W = Math.PI * notr - kaynak;
      if (!(W > 0)) throw new GirdiHatasi("Kaynak aralığı çevreye göre çok büyük.");
      Object.assign(m, { dis, boy, dilim, onBukum, ic, notr, cikis: "rulo", genislik: W, uzunluk: boy });
      for (let i = 1; i < dilim; i++) m.cizgiler.push({ x: (W * i) / dilim, tur: "ref" });
      if (onBukum > 0) {
        m.onCizgiler = [onBukum, W - onBukum];
        if (onBukum * 2 >= W) m.uyarilar.push("Ön büküm payı açılım genişliğine göre çok büyük görünüyor.");
      }
      m.segs = [{ tur: "duz", len: W }];
      const oran = dis / et;
      if (oran < 10)
        m.uyarilar.push(
          "Dış çap / et kalınlığı oranı 10'un altında. Bu kalın ve küçük çaplı boru rulo makinesinde zor bükülebilir; K faktörünü deneme ile doğrulayın.",
        );
      else if (oran < 20)
        m.uyarilar.push(
          "Dış çap / et kalınlığı oranı düşük. K faktörünü ilk parçada deneme ile doğrulamanız önerilir.",
        );
      m.kesit = { tur: "daire", ro: dis / 2, ri: dis / 2 - et };
      m.boy3 = boy;
      m.alan = W * boy;
    } else if (tip === "kare" || tip === "cokgen") {
      const boy = pz(+g.boy, "Boru boyu");
      const ri = g.ri === undefined || g.ri === "" || g.ri === null ? et : +g.ri;
      if (!(ri >= 0)) throw new GirdiHatasi("İç büküm yarıçapı negatif olamaz.");
      const Ro = ri + et;
      if (ri < et)
        m.uyarilar.push(
          "İç büküm yarıçapı sac kalınlığından küçük; abkantta çatlama riski olur, kalıp ve malzemeye göre kontrol edin.",
        );
      let straights, bukumAci, kesit;
      if (tip === "kare") {
        const a = pz(+g.a, "Dış genişlik"),
          b = pz(+g.b, "Dış yükseklik");
        const sA = a - 2 * Ro,
          sB = b - 2 * Ro;
        if (sA <= 0.01 || sB <= 0.01)
          throw new GirdiHatasi("Dış ölçüler, köşe yarıçapına (iç yarıçap + et kalınlığı) göre çok küçük.");
        bukumAci = Math.PI / 2;
        straights = [sA, sB, sA, sB];
        Object.assign(m, { a, b });
        kesit = { tur: "kare", a, b, ro: Ro, ri };
      } else {
        const n = Math.round(+g.n),
          af = pz(+g.af, "Dış ölçü (karşılıklı kenar mesafesi)");
        if (!(n >= 3 && n <= 24)) throw new GirdiHatasi("Kenar sayısı 3 ile 24 arasında olmalı.");
        const th = (2 * Math.PI) / n,
          ossb = Ro * Math.tan(th / 2),
          sOuter = af * Math.tan(Math.PI / n),
          s = sOuter - 2 * ossb;
        if (s <= 0.01 || af / 2 - Ro <= 0.01)
          throw new GirdiHatasi("Dış ölçü, köşe yarıçapına göre çok küçük.");
        bukumAci = th;
        straights = new Array(n).fill(s);
        Object.assign(m, { n, af });
        kesit = { tur: "cokgen", n, af, ro: Ro, ri };
      }
      const BA = bukumAci * (ri + k * et),
        n = straights.length;
      const ilk = straights[0] / 2 - kaynak / 2;
      if (ilk <= 0) throw new GirdiHatasi("Kaynak aralığı kenar uzunluğuna göre çok büyük.");
      m.segs.push({ tur: "duz", len: ilk });
      let x = ilk;
      for (let i = 0; i < n; i++) {
        m.segs.push({ tur: "bukum", len: BA, aci: (bukumAci * 180) / Math.PI });
        m.cizgiler.push({ x: x + BA / 2, tur: "bukum", aci: (bukumAci * 180) / Math.PI });
        x += BA;
        const duz = i < n - 1 ? straights[i + 1] : ilk;
        m.segs.push({ tur: "duz", len: duz });
        x += duz;
      }
      Object.assign(m, {
        ri,
        ro: Ro,
        boy,
        cikis: "abkant",
        genislik: x,
        uzunluk: boy,
        bukumPayi: BA,
        kesit,
        boy3: boy,
      });
      m.alan = x * boy;
    } else {
      // konik
      const D1 = pz(+g.d1, "Büyük dış çap"),
        D2 = pz(+g.d2, "Küçük dış çap"),
        h = pz(+g.h, "Yükseklik");
      const buyuk = Math.max(D1, D2),
        kucuk = Math.min(D1, D2);
      const rn1 = buyuk / 2 - et * (1 - k),
        rn2 = kucuk / 2 - et * (1 - k);
      if (rn2 <= 0) throw new GirdiHatasi("Küçük çap, sac kalınlığına göre çok küçük.");
      const d = rn1 - rn2;
      if (d < 1e-6) throw new GirdiHatasi('Büyük ve küçük çap aynı. Silindir için "Yuvarlak" tipini seçin.');
      const l = Math.hypot(h, d),
        R1 = (l * rn1) / d,
        R2 = (l * rn2) / d,
        phi = (2 * Math.PI * d) / l;
      const faz = phi - kaynak / R1;
      if (!(faz > 0)) throw new GirdiHatasi("Kaynak aralığı açılıma göre çok büyük.");
      const a0 = -Math.PI / 2 - faz / 2,
        a1 = -Math.PI / 2 + faz / 2;
      // sınır kutusu
      const nok = [
        [R1 * Math.cos(a0), R1 * Math.sin(a0)],
        [R1 * Math.cos(a1), R1 * Math.sin(a1)],
        [R2 * Math.cos(a0), R2 * Math.sin(a0)],
        [R2 * Math.cos(a1), R2 * Math.sin(a1)],
      ];
      for (let i = 0; i <= 720; i++) {
        const t = a0 + ((a1 - a0) * i) / 720;
        nok.push([R1 * Math.cos(t), R1 * Math.sin(t)], [R2 * Math.cos(t), R2 * Math.sin(t)]);
      }
      const kb = kutu(nok);
      Object.assign(m, {
        dis1: buyuk,
        dis2: kucuk,
        h,
        rn1,
        rn2,
        R1,
        R2,
        phi,
        faz,
        a0,
        a1,
        egimUzunlugu: l,
        cikis: "rulo",
        ox: -kb[0],
        oy: -kb[1],
        genislik: kb[2] - kb[0],
        uzunluk: kb[3] - kb[1],
        boy3: h,
        kesit: { tur: "konik", r0: buyuk / 2, r1: kucuk / 2, et },
      });
      m.alan = (faz / 2) * (R1 * R1 - R2 * R2);
      if ((faz * 180) / Math.PI > 200)
        m.uyarilar.push("Açılım açısı büyük; sac yerleşimini ve rulo makinesi kapasitesini kontrol edin.");
    }
    if (m.kesit.tur === "daire" || m.kesit.tur === "konik") {
      const oran = (m.dis || m.dis1) / et;
      if (tip === "konik" && oran < 10)
        m.uyarilar.push("Küçük uçta çap / et oranı düşük; rulo ile bükmek zor olabilir.");
    }
    m.agirlik = (m.alan * et * YOGUNLUK[malzeme]) / 1e6; // mm³ * g/cm³ -> kg
    return m;
  }

  // Açılım çizimi: DXF ve şema için ortak varlık listesi (sac koordinatları, sol-alt köşe 0,0)
  function boruCizim(m) {
    const v = [];
    if (m.tip === "konik") {
      const ox = m.ox,
        oy = m.oy,
        d = 180 / Math.PI;
      const P = (r, a) => [ox + r * Math.cos(a), oy + r * Math.sin(a)];
      const p1 = P(m.R1, m.a0),
        p2 = P(m.R1, m.a1),
        q1 = P(m.R2, m.a0),
        q2 = P(m.R2, m.a1);
      v.push({ t: "arc", katman: "KESIM", cx: ox, cy: oy, r: m.R1, a0: m.a0 * d, a1: m.a1 * d });
      v.push({ t: "arc", katman: "KESIM", cx: ox, cy: oy, r: m.R2, a0: m.a0 * d, a1: m.a1 * d });
      v.push({ t: "line", katman: "KESIM", x1: p1[0], y1: p1[1], x2: q1[0], y2: q1[1] });
      v.push({ t: "line", katman: "KESIM", x1: p2[0], y1: p2[1], x2: q2[0], y2: q2[1] });
      const mid = -Math.PI / 2;
      const r1 = P(m.R1, mid),
        r2 = P(m.R2, mid);
      v.push({ t: "line", katman: "BUKUM_REF", x1: r1[0], y1: r1[1], x2: r2[0], y2: r2[1] });
      return v;
    }
    const W = m.genislik,
      L = m.uzunluk;
    v.push({
      t: "poly",
      katman: "KESIM",
      kapali: true,
      pts: [
        [0, 0],
        [W, 0],
        [W, L],
        [0, L],
      ],
    });
    for (const c of m.cizgiler)
      v.push({
        t: "line",
        katman: c.tur === "bukum" ? "BUKUM" : "BUKUM_REF",
        x1: c.x,
        y1: 0,
        x2: c.x,
        y2: L,
      });
    for (const x of m.onCizgiler) v.push({ t: "line", katman: "ON_BUKUM", x1: x, y1: 0, x2: x, y2: L });
    return v;
  }

  function boruDxf(g) {
    const m = boruModel(g);
    const v = boruCizim(m);
    const W = m.genislik,
      L = m.uzunluk,
      h = Math.max(Math.min(W, L) / 40, 3);
    const ad = {
      yuvarlak: "Yuvarlak boru (rulo)",
      kare: "Kare/dikdortgen boru (abkant)",
      cokgen: "Cokgen boru (abkant)",
      konik: "Konik boru (rulo)",
    }[m.tip];
    v.push({
      t: "text",
      katman: "YAZI",
      x: 0,
      y: -2.5 * h,
      h,
      metin: `${ad} | Acilim ${W.toFixed(2)} x ${L.toFixed(2)} mm | Et ${m.et} | K ${m.k}`,
    });
    if (m.tip === "kare" || m.tip === "cokgen") {
      m.cizgiler.forEach((c, i) =>
        v.push({
          t: "text",
          katman: "YAZI",
          x: c.x + h * 0.4,
          y: L + h * 0.5,
          h: h * 0.7,
          metin: `B${i + 1} ${c.aci.toFixed(0)} derece`,
          aci: 90,
        }),
      );
    }
    return dxfYaz(
      [
        { ad: "KESIM", renk: 7 },
        { ad: "BUKUM", renk: 1, cizgi: "DASHED" },
        { ad: "BUKUM_REF", renk: 1, cizgi: "DASHED" },
        { ad: "ON_BUKUM", renk: 3, cizgi: "DASHED" },
        { ad: "YAZI", renk: 5 },
      ],
      v,
    );
  }

  // ---- 3D ağ (mesh): eksen Z boyunca, kesit XY düzleminde ----
  function kesitYuvarlak(arcs, ustY, Ro, Ri) {
    const dis = [{ x: 0, y: ustY + Ro, nx: 0, ny: 1 }],
      ic = [{ x: 0, y: ustY + Ri, nx: 0, ny: 1 }];
    for (const a of arcs) {
      const adim = Math.max(3, Math.ceil((Math.abs(a.a1 - a.a0) / (Math.PI / 2)) * 10));
      for (let s = 0; s <= adim; s++) {
        const al = a.a0 + ((a.a1 - a.a0) * s) / adim,
          c = Math.cos(al),
          sn = Math.sin(al);
        dis.push({ x: a.cx + Ro * c, y: a.cy + Ro * sn, nx: c, ny: sn });
        ic.push({ x: a.cx + Ri * c, y: a.cy + Ri * sn, nx: c, ny: sn });
      }
    }
    return { dis, ic };
  }
  function kesitDaire(ro, ri, N) {
    const dis = [],
      ic = [];
    for (let i = 0; i < N; i++) {
      const a = Math.PI / 2 + (2 * Math.PI * i) / N,
        c = Math.cos(a),
        s = Math.sin(a);
      dis.push({ x: ro * c, y: ro * s, nx: c, ny: s });
      ic.push({ x: ri * c, y: ri * s, nx: c, ny: s });
    }
    return { dis, ic };
  }

  function boruMesh(m) {
    const kes = m.kesit,
      L = m.boy3;
    let s0,
      s1,
      egim = 0,
      boyut;
    if (kes.tur === "daire") {
      s0 = s1 = kesitDaire(kes.ro, kes.ri, 120);
      boyut = kes.ro * 2;
    } else if (kes.tur === "konik") {
      s0 = kesitDaire(kes.r0, kes.r0 - kes.et, 120);
      s1 = kesitDaire(kes.r1, kes.r1 - kes.et, 120);
      egim = (kes.r1 - kes.r0) / L;
      boyut = kes.r0 * 2;
    } else if (kes.tur === "kare") {
      const cx = kes.a / 2 - kes.ro,
        cy = kes.b / 2 - kes.ro,
        P = Math.PI;
      s0 = s1 = kesitYuvarlak(
        [
          { cx: -cx, cy: cy, a0: P / 2, a1: P },
          { cx: -cx, cy: -cy, a0: P, a1: 1.5 * P },
          { cx: cx, cy: -cy, a0: 1.5 * P, a1: 2 * P },
          { cx: cx, cy: cy, a0: 0, a1: P / 2 },
        ],
        cy,
        kes.ro,
        kes.ri,
      );
      boyut = Math.min(kes.a, kes.b);
    } else {
      const n = kes.n,
        th = (2 * Math.PI) / n,
        ap = kes.af / 2 - kes.ro,
        dc = ap / Math.cos(Math.PI / n),
        arcs = [];
      for (let i = 0; i < n; i++) {
        const t0 = Math.PI / 2 + i * th,
          fi = t0 + th / 2;
        arcs.push({ cx: dc * Math.cos(fi), cy: dc * Math.sin(fi), a0: t0, a1: t0 + th });
      }
      s0 = s1 = kesitYuvarlak(arcs, ap, kes.ro, kes.ri);
      boyut = kes.af;
    }
    const pos = [],
      nor = [],
      tri = [],
      tip = [];
    const v = (x, y, z, n) => {
      pos.push(x, y, z);
      nor.push(n[0], n[1], n[2]);
      return pos.length / 3 - 1;
    };
    const nrm = (a, b, c) => {
      const l = Math.hypot(a, b, c) || 1;
      return [a / l, b / l, c / l];
    };
    const N = s0.dis.length;
    const yuzey = (a, b, is, t) => {
      const i0 = [],
        i1 = [];
      for (let i = 0; i < N; i++) {
        i0.push(v(a[i].x, a[i].y, 0, nrm(is * a[i].nx, is * a[i].ny, -is * egim)));
        i1.push(v(b[i].x, b[i].y, L, nrm(is * b[i].nx, is * b[i].ny, -is * egim)));
      }
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        tri.push(i0[i], i0[j], i1[j], i0[i], i1[j], i1[i]);
        tip.push(t, t);
      }
    };
    yuzey(s0.dis, s1.dis, 1, 0);
    yuzey(s0.ic, s1.ic, -1, 1);
    for (const e of [
      [s0, 0, -1],
      [s1, L, 1],
    ]) {
      const od = [],
        oi = [];
      for (let i = 0; i < N; i++) {
        od.push(v(e[0].dis[i].x, e[0].dis[i].y, e[1], [0, 0, e[2]]));
        oi.push(v(e[0].ic[i].x, e[0].ic[i].y, e[1], [0, 0, e[2]]));
      }
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        tri.push(od[i], od[j], oi[j], od[i], oi[j], oi[i]);
        tip.push(2, 2);
      }
    }
    let mn = [Infinity, Infinity, Infinity],
      mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let a = 0; a < 3; a++) {
        if (pos[i + a] < mn[a]) mn[a] = pos[i + a];
        if (pos[i + a] > mx[a]) mx[a] = pos[i + a];
      }
    // kaynak dikişi: dış yüzeyde, ilk noktada ince şerit (yüzeyin hemen üstünde, derinlik çakışması olmasın)
    const w = Math.max(0.5, boyut * 0.012),
      off = Math.max(0.05, boyut * 0.0015),
      p0 = s0.dis[0],
      p1 = s1.dis[0],
      nn = nrm(p0.nx, p0.ny, -egim);
    const e4 = (p, z, sg) => v(p.x - p.ny * w * sg + p.nx * off, p.y + p.nx * w * sg + p.ny * off, z, nn);
    const q = [e4(p0, 0, -1), e4(p0, 0, 1), e4(p1, L, 1), e4(p1, L, -1)];
    tri.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    tip.push(3, 3);
    return { pos, nor, tri, tip, min: mn, max: mx, L };
  }

  // =====================================================================
  //  PROFİL BOY KESİM (1 boyutlu)
  // =====================================================================
  function rng(tohum) {
    let a = tohum >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function profilOptimize(anaBoy, kerf, parcalar, sureMs, tohum) {
    sureMs = sureMs === undefined ? 1500 : sureMs;
    anaBoy = +anaBoy;
    kerf = +kerf;
    if (!(anaBoy > 0)) throw new GirdiHatasi("Ana profil boyu 0'dan büyük olmalı.");
    if (!(kerf >= 0)) throw new GirdiHatasi("Testere payı negatif olamaz.");
    if (!parcalar || !parcalar.length) throw new GirdiHatasi("En az bir parça girmelisiniz.");
    const duz = [];
    for (const p of parcalar) {
      const boy = +p.boy,
        adet = +p.adet;
      if (!(boy > 0)) throw new GirdiHatasi("Parça boyları 0'dan büyük olmalı.");
      if (!(Number.isInteger(adet) && adet >= 1))
        throw new GirdiHatasi("Parça adetleri 1 veya daha büyük tam sayı olmalı.");
      if (boy > anaBoy + 1e-9)
        throw new GirdiHatasi(`${boy} mm parça, ${anaBoy} mm ana boydan uzun; kesilemez.`);
      if (duz.length + adet > 5000) throw new GirdiHatasi("Toplam parça adedi 5000 sınırını aşıyor.");
      for (let i = 0; i < adet; i++) duz.push(boy);
    }
    const sigar = (net, n, boy) => net + boy + n * kerf <= anaBoy + 1e-9;
    function ffd(liste) {
      const c = [],
        t = [];
      for (const p of liste) {
        let ok = false;
        for (let i = 0; i < c.length; i++)
          if (sigar(t[i], c[i].length, p)) {
            c[i].push(p);
            t[i] += p;
            ok = true;
            break;
          }
        if (!ok) {
          c.push([p]);
          t.push(p);
        }
      }
      return c;
    }
    function bfd(liste) {
      const c = [],
        t = [];
      for (const p of liste) {
        let en = -1,
          enKalan = Infinity;
        for (let i = 0; i < c.length; i++)
          if (sigar(t[i], c[i].length, p)) {
            const kalan = anaBoy - (t[i] + p + c[i].length * kerf);
            if (kalan < enKalan) {
              en = i;
              enKalan = kalan;
            }
          }
        if (en >= 0) {
          c[en].push(p);
          t[en] += p;
        } else {
          c.push([p]);
          t.push(p);
        }
      }
      return c;
    }
    const topla = (a) => a.reduce((x, y) => x + y, 0);
    const skor = (c) => [c.length, -Math.max(...c.map((x) => anaBoy - (topla(x) + (x.length - 1) * kerf)))];
    const daha = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const azalan = duz.slice().sort((a, b) => b - a);
    let en = [ffd(azalan), bfd(azalan)].reduce((a, b) => (daha(skor(b), skor(a)) ? b : a));
    const altSinir = Math.max(1, Math.ceil(duz.reduce((a, p) => a + p + kerf, 0) / (anaBoy + kerf) - 1e-9));
    const r = rng(tohum || 1);
    const bitis = Date.now() + sureMs;
    while (en.length > altSinir && Date.now() < bitis) {
      const l = azalan.slice();
      const adim = Math.max(1, Math.floor(l.length / 5));
      for (let k = 0; k < adim; k++) {
        const i = Math.floor(r() * l.length);
        const j = Math.min(l.length - 1, Math.max(0, i + Math.floor(r() * 7) - 3));
        const x = l[i];
        l[i] = l[j];
        l[j] = x;
      }
      const d = r() < 0.5 ? ffd(l) : bfd(l);
      if (daha(skor(d), skor(en))) en = d;
    }
    const cubuklar = en
      .slice()
      .sort((a, b) => topla(b) - topla(a) || b.length - a.length)
      .map((c) => {
        const kul = topla(c) + (c.length - 1) * kerf;
        return {
          parcalar: c.slice().sort((a, b) => b - a),
          kullanilan: kul,
          artik: Math.max(0, anaBoy - kul),
        };
      });
    const gr = new Map();
    for (const c of cubuklar) {
      const k = c.parcalar.join("|");
      if (!gr.has(k)) gr.set(k, { adet: 0, parcalar: c.parcalar, kullanilan: c.kullanilan, artik: c.artik });
      gr.get(k).adet++;
    }
    const toplamMalzeme = anaBoy * cubuklar.length;
    const parcaToplam = topla(duz);
    const fire = toplamMalzeme - parcaToplam;
    const uyarilar = [];
    if (cubuklar.length > altSinir)
      uyarilar.push(
        `Teorik alt sınır ${altSinir} çubuk; bu plan ${cubuklar.length} çubuk kullanıyor. Daha iyisi mümkün olabilir ama garanti edilemiyor.`,
      );
    return {
      anaBoy,
      kerf,
      cubukSayisi: cubuklar.length,
      altSinir,
      toplamMalzeme,
      parcaToplam,
      fire,
      firePct: toplamMalzeme ? (100 * fire) / toplamMalzeme : 0,
      cubuklar,
      gruplar: Array.from(gr.values()).sort((a, b) => b.adet - a.adet),
      uyarilar,
    };
  }

  // =====================================================================
  //  GEOMETRİ YARDIMCILARI
  // =====================================================================
  function alanIsaretli(r) {
    let a = 0;
    for (let i = 0, n = r.length; i < n; i++) {
      const p = r[i],
        q = r[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  function kutu(r) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of r) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  }
  function noktaHalkada(r, x, y) {
    let ic = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0],
        yi = r[i][1],
        xj = r[j][0],
        yj = r[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ic = !ic;
    }
    return ic;
  }
  function sadelestirHalka(r, tol) {
    if (r.length <= 80) return r;
    // Douglas-Peucker: halka iki parçaya bölünür
    let en = 0,
      enD = -1;
    for (let i = 1; i < r.length; i++) {
      const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
      if (d > enD) {
        enD = d;
        en = i;
      }
    }
    const a = r.slice(0, en + 1),
      b = r.slice(en).concat([r[0]]);
    function dp(p) {
      const keep = new Uint8Array(p.length);
      keep[0] = 1;
      keep[p.length - 1] = 1;
      const st = [[0, p.length - 1]];
      while (st.length) {
        const [s, e] = st.pop();
        let md = 0,
          mi = -1;
        const ax = p[s][0],
          ay = p[s][1],
          bx = p[e][0],
          by = p[e][1];
        const dx = bx - ax,
          dy = by - ay,
          l2 = dx * dx + dy * dy;
        for (let i = s + 1; i < e; i++) {
          let d;
          if (l2 === 0) d = Math.hypot(p[i][0] - ax, p[i][1] - ay);
          else d = Math.abs(dy * (p[i][0] - ax) - dx * (p[i][1] - ay)) / Math.sqrt(l2);
          if (d > md) {
            md = d;
            mi = i;
          }
        }
        if (md > tol && mi > 0) {
          keep[mi] = 1;
          st.push([s, mi], [mi, e]);
        }
      }
      return p.filter((_, i) => keep[i]);
    }
    const ra = dp(a),
      rb = dp(b);
    return ra.concat(rb.slice(1, -1));
  }

  // =====================================================================
  //  DXF OKUMA
  // =====================================================================
  function grupla(metin) {
    const L = metin.split(/\r\n|\r|\n/);
    const G = [];
    let i = 0;
    while (i + 1 < L.length) {
      const a = L[i].trim();
      // Kod satırı sayı değilse (boş satır, bozuk satır) yalnızca o satırı atla.
      if (!/^-?\d+$/.test(a)) {
        i++;
        continue;
      }
      G.push([parseInt(a, 10), L[i + 1].trim()]);
      i += 2;
    }
    return G;
  }

  function dxfIcerik(metin) {
    if (/^AC10\d\d/.test(metin))
      throw new GirdiHatasi(
        'Bu bir DWG dosyası. AutoCAD/CAD programında "DXF olarak kaydet" ile metin DXF üretin.',
      );
    const G = grupla(metin);
    if (G.length < 4) throw new GirdiHatasi("Bu dosya DXF gibi görünmüyor (içeriği okunamadı).");
    const kayitlar = [];
    let k = null;
    for (const g of G) {
      if (g[0] === 0) {
        k = { tip: g[1], g: [] };
        kayitlar.push(k);
      } else if (k) k.g.push(g);
    }
    let birim = 0;
    for (let i = 0; i < G.length - 1; i++)
      if (G[i][0] === 9 && G[i][1] === "$INSUNITS" && G[i + 1][0] === 70) birim = parseInt(G[i + 1][1], 10);
    let bolum = null,
      blok = null;
    const varliklar = [],
      bloklar = {},
      katmanlar = {};
    for (const r of kayitlar) {
      if (r.tip === "SECTION") {
        const a = r.g.find((x) => x[0] === 2);
        bolum = a ? a[1] : null;
        blok = null;
        continue;
      }
      if (r.tip === "ENDSEC") {
        bolum = null;
        blok = null;
        continue;
      }
      if (r.tip === "EOF") break;
      if (bolum === "ENTITIES") {
        const kagit = r.g.find((x) => x[0] === 67);
        if (!kagit || parseInt(kagit[1], 10) !== 1) varliklar.push(r); // kağıt uzayındakiler çizim değil, düzen
      } else if (bolum === "TABLES") {
        if (r.tip === "LAYER") {
          const ad = r.g.find((x) => x[0] === 2),
            bayrak = r.g.find((x) => x[0] === 70),
            renk = r.g.find((x) => x[0] === 62);
          if (ad)
            katmanlar[ad[1].toUpperCase()] = {
              kapali:
                ((bayrak ? parseInt(bayrak[1], 10) : 0) & 1) === 1 ||
                (renk ? parseInt(renk[1], 10) < 0 : false),
            };
        }
      } else if (bolum === "BLOCKS") {
        if (r.tip === "BLOCK") {
          const ad = r.g.find((x) => x[0] === 2),
            bx = r.g.find((x) => x[0] === 10),
            by = r.g.find((x) => x[0] === 20);
          blok = {
            ad: ad ? ad[1] : "",
            bx: bx ? parseFloat(bx[1]) : 0,
            by: by ? parseFloat(by[1]) : 0,
            varliklar: [],
          };
          bloklar[blok.ad] = blok;
        } else if (r.tip === "ENDBLK") blok = null;
        else if (blok) blok.varliklar.push(r);
      }
    }
    return { varliklar, bloklar, birim, katmanlar };
  }

  const al = (r, k, d) => {
    const g = r.g.find((x) => x[0] === k);
    return g ? parseFloat(g[1]) : d === undefined ? 0 : d;
  };

  function yaySayisi(r, sweep) {
    if (r <= SAG_MM) return 4;
    const dt = 2 * Math.acos(Math.max(0, 1 - SAG_MM / r));
    return Math.max(2, Math.min(2000, Math.ceil(Math.abs(sweep) / dt)));
  }
  function yayNoktalari(cx, cy, r, a0, sweep) {
    const n = yaySayisi(r, sweep),
      p = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (sweep * i) / n;
      p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return p;
  }

  // Köşe + şişkinlik (bulge) listesinden düzleştirilmiş nokta dizisi
  function bulgeNoktalari(kose, kapali) {
    const out = [];
    const n = kose.length,
      adet = kapali ? n : n - 1;
    for (let i = 0; i < adet; i++) {
      const a = kose[i],
        b = kose[(i + 1) % n];
      if (i === 0) out.push([a.x, a.y]);
      const bl = a.b || 0;
      const c = Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.abs(bl) > 1e-9 && c > 1e-9) {
        const th = 4 * Math.atan(bl);
        const R = c / (2 * Math.sin(Math.abs(th) / 2));
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        const dx = (b.x - a.x) / c,
          dy = (b.y - a.y) / c;
        const d = R * Math.cos(Math.abs(th) / 2);
        const sg = bl > 0 ? 1 : -1;
        const cx = mx + -dy * sg * d,
          cy = my + dx * sg * d;
        const a0 = Math.atan2(a.y - cy, a.x - cx);
        const pts = yayNoktalari(cx, cy, R, a0, th);
        for (let k = 1; k < pts.length; k++) out.push(pts[k]);
        // son nokta tam b olsun
        out[out.length - 1] = [b.x, b.y];
      } else if (!(kapali && i === n - 1)) {
        out.push([b.x, b.y]);
      }
    }
    return out;
  }

  function nurbs(r) {
    const derece = al(r, 71, 3);
    const knots = r.g.filter((x) => x[0] === 40).map((x) => parseFloat(x[1]));
    const w = r.g.filter((x) => x[0] === 41).map((x) => parseFloat(x[1]));
    const cp = [];
    for (let i = 0; i < r.g.length; i++)
      if (r.g[i][0] === 10) {
        const x = parseFloat(r.g[i][1]);
        let y = 0;
        for (let j = i + 1; j < Math.min(i + 3, r.g.length); j++)
          if (r.g[j][0] === 20) {
            y = parseFloat(r.g[j][1]);
            break;
          }
        cp.push([x, y]);
      }
    const fit = [];
    for (let i = 0; i < r.g.length; i++)
      if (r.g[i][0] === 11) {
        const x = parseFloat(r.g[i][1]);
        let y = 0;
        for (let j = i + 1; j < Math.min(i + 3, r.g.length); j++)
          if (r.g[j][0] === 21) {
            y = parseFloat(r.g[j][1]);
            break;
          }
        fit.push([x, y]);
      }
    const n = cp.length - 1,
      p = derece;
    if (cp.length > p && knots.length === n + p + 2) {
      const ucp = knots[p],
        uson = knots[n + 1];
      if (uson > ucp) {
        const N = Math.max(24, Math.min(3000, cp.length * 16));
        const pts = [];
        for (let s = 0; s <= N; s++) {
          const u = Math.min(ucp + ((uson - ucp) * s) / N, uson - 1e-12 * (uson - ucp));
          let span = p;
          while (span < n && u >= knots[span + 1]) span++;
          const Nb = new Array(p + 1).fill(0);
          Nb[0] = 1;
          const left = [],
            right = [];
          for (let j = 1; j <= p; j++) {
            left[j] = u - knots[span + 1 - j];
            right[j] = knots[span + j] - u;
            let saved = 0;
            for (let rr = 0; rr < j; rr++) {
              const den = right[rr + 1] + left[j - rr];
              const tmp = den === 0 ? 0 : Nb[rr] / den;
              Nb[rr] = saved + right[rr + 1] * tmp;
              saved = left[j - rr] * tmp;
            }
            Nb[j] = saved;
          }
          let x = 0,
            y = 0,
            ws = 0;
          for (let j = 0; j <= p; j++) {
            const idx = span - p + j,
              wt = w.length === cp.length ? w[idx] : 1;
            x += Nb[j] * wt * cp[idx][0];
            y += Nb[j] * wt * cp[idx][1];
            ws += Nb[j] * wt;
          }
          pts.push(ws ? [x / ws, y / ws] : [x, y]);
        }
        return pts;
      }
    }
    if (fit.length >= 2) return fit;
    return cp;
  }

  // Kayıt listesini (bir bölümün varlıkları) düzleştirilmiş çok çizgilere çevirir
  function varliklariCoz(liste, bloklar, derinlik, sayac) {
    const out = [];
    for (let i = 0; i < liste.length; i++) {
      const r = liste[i];
      if (++sayac.n > MAX_VARLIK)
        throw new GirdiHatasi(`${MAX_VARLIK} varlık sınırı aşıldı, dosya çok karmaşık.`);
      const katman = (r.g.find((x) => x[0] === 8) || [0, ""])[1].toUpperCase();
      if (katman === "DEFPOINTS") {
        if (r.tip === "POLYLINE") while (i + 1 < liste.length && liste[i + 1].tip !== "SEQEND") i++;
        continue;
      }
      const bas = out.length,
        nz = al(r, 230, 1);
      switch (r.tip) {
        case "LINE":
          out.push({
            pts: [
              [al(r, 10), al(r, 20)],
              [al(r, 11), al(r, 21)],
            ],
            kapali: false,
          });
          break;
        case "CIRCLE": {
          const rad = al(r, 40);
          if (rad > 0) {
            const p = yayNoktalari(al(r, 10), al(r, 20), rad, 0, 2 * Math.PI);
            p.pop();
            out.push({ pts: p, kapali: true });
          }
          break;
        }
        case "ARC": {
          const rad = al(r, 40);
          let a0 = (al(r, 50) * Math.PI) / 180,
            a1 = (al(r, 51) * Math.PI) / 180;
          while (a1 <= a0) a1 += 2 * Math.PI;
          if (rad > 0) out.push({ pts: yayNoktalari(al(r, 10), al(r, 20), rad, a0, a1 - a0), kapali: false });
          break;
        }
        case "ELLIPSE": {
          const cx = al(r, 10),
            cy = al(r, 20),
            mx = al(r, 11),
            my = al(r, 21),
            oran = al(r, 40, 1);
          let t0 = al(r, 41, 0),
            t1 = al(r, 42, 2 * Math.PI);
          while (t1 <= t0) t1 += 2 * Math.PI;
          const tam = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
          const bx = -my * oran,
            by = mx * oran;
          const N = Math.max(
            24,
            Math.min(1500, Math.ceil(((t1 - t0) / (2 * Math.PI)) * Math.max(48, Math.hypot(mx, my) * 0.8))),
          );
          const p = [];
          for (let s = 0; s <= N; s++) {
            const t = t0 + ((t1 - t0) * s) / N;
            p.push([cx + mx * Math.cos(t) + bx * Math.sin(t), cy + my * Math.cos(t) + by * Math.sin(t)]);
          }
          if (tam) p.pop();
          out.push({ pts: p, kapali: tam });
          break;
        }
        case "LWPOLYLINE": {
          const kose = [];
          for (const g of r.g) {
            if (g[0] === 10) kose.push({ x: parseFloat(g[1]), y: 0, b: 0 });
            else if (g[0] === 20 && kose.length) kose[kose.length - 1].y = parseFloat(g[1]);
            else if (g[0] === 42 && kose.length) kose[kose.length - 1].b = parseFloat(g[1]);
          }
          const kapali = (parseInt((r.g.find((x) => x[0] === 70) || [0, "0"])[1], 10) & 1) === 1;
          if (kose.length >= 2) out.push({ pts: bulgeNoktalari(kose, kapali), kapali });
          break;
        }
        case "POLYLINE": {
          const bayrak = parseInt((r.g.find((x) => x[0] === 70) || [0, "0"])[1], 10);
          const kose = [];
          while (i + 1 < liste.length && liste[i + 1].tip !== "SEQEND") {
            i++;
            const v = liste[i];
            if (v.tip !== "VERTEX") continue;
            const vb = parseInt((v.g.find((x) => x[0] === 70) || [0, "0"])[1], 10);
            if (vb & 16) continue; // spline çerçeve noktası
            kose.push({ x: al(v, 10), y: al(v, 20), b: al(v, 42) });
          }
          if (i + 1 < liste.length && liste[i + 1].tip === "SEQEND") i++;
          if (!(bayrak & (16 | 64)) && kose.length >= 2)
            out.push({ pts: bulgeNoktalari(kose, (bayrak & 1) === 1), kapali: (bayrak & 1) === 1 });
          break;
        }
        case "SPLINE": {
          const p = nurbs(r);
          if (p.length >= 2) {
            const kapali =
              (parseInt((r.g.find((x) => x[0] === 70) || [0, "0"])[1], 10) & 1) === 1 ||
              Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < BIRLESTIRME_MM;
            if (
              kapali &&
              Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < BIRLESTIRME_MM
            )
              p.pop();
            out.push({ pts: p, kapali });
          }
          break;
        }
        case "INSERT": {
          if (derinlik >= 6) break;
          const b = bloklar[(r.g.find((x) => x[0] === 2) || [0, ""])[1]];
          if (!b) break;
          const sx = al(r, 41, 1),
            sy = al(r, 42, 1),
            rot = (al(r, 50, 0) * Math.PI) / 180;
          const ix = al(r, 10),
            iy = al(r, 20),
            c = Math.cos(rot),
            s = Math.sin(rot);
          const alt = varliklariCoz(b.varliklar, bloklar, derinlik + 1, sayac);
          for (const pl of alt) {
            out.push({
              kapali: pl.kapali,
              katman: pl.katman === "0" ? katman : pl.katman,
              pts: pl.pts.map((q) => {
                const x = (q[0] - b.bx) * sx,
                  y = (q[1] - b.by) * sy;
                return [ix + x * c - y * s, iy + x * s + y * c];
              }),
            });
          }
          break;
        }
        default:
          if (YOKSAY[r.tip] && sayac.yok) sayac.yok[r.tip] = (sayac.yok[r.tip] || 0) + 1;
          break;
      }
      for (let q = bas; q < out.length; q++) {
        if (out[q].katman === undefined) {
          out[q].katman = katman;
          if (nz < 0) out[q].pts = out[q].pts.map((p) => [-p[0], p[1]]);
        }
      }
    }
    return out;
  }

  // Çizgileri düğümlere bağlar, kesişim ve T birleşimlerinde böler, boşta kalan uçları budar ve
  // düzlemsel grafiğin kapalı yüzlerini (konturlarını) çıkarır. Taşan çizgiler ve küçük
  // boşluklar tol ile tolere edilir.
  function yuzleriBul(cizgiler, tol) {
    const X = [],
      Y = [],
      hucre = new Map();
    function dugum(x, y) {
      const cx = Math.floor(x / tol),
        cy = Math.floor(y / tol);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const l = hucre.get(cx + dx + "," + (cy + dy));
          if (l) for (const id of l) if (Math.hypot(X[id] - x, Y[id] - y) <= tol) return id;
        }
      const id = X.length;
      X.push(x);
      Y.push(y);
      const key = cx + "," + cy,
        l = hucre.get(key);
      if (l) l.push(id);
      else hucre.set(key, [id]);
      return id;
    }
    let seg = [];
    const var1 = new Set();
    const ekle = (list, set, a, b) => {
      if (a === b) return;
      const k = a < b ? a + "_" + b : b + "_" + a;
      if (set.has(k)) return;
      set.add(k);
      list.push([a, b]);
    };
    for (const pl of cizgiler) {
      const ids = pl.pts.map((p) => dugum(p[0], p[1]));
      for (let i = 0; i + 1 < ids.length; i++) ekle(seg, var1, ids[i], ids[i + 1]);
      if (pl.kapali && ids.length > 2) ekle(seg, var1, ids[ids.length - 1], ids[0]);
    }
    if (seg.length > 60000)
      throw new GirdiHatasi(
        "Çizim çok karmaşık (60.000'den fazla çizgi parçası). Gereksiz katmanları kapatın.",
      );
    const n = seg.length;
    if (n === 0) return { halkalar: [], acikUc: 0, acikNoktalar: [] };

    // ---- kesişim noktalarında bölme ----
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < X.length; i++) {
      if (X[i] < x0) x0 = X[i];
      if (X[i] > x1) x1 = X[i];
      if (Y[i] < y0) y0 = Y[i];
      if (Y[i] > y1) y1 = Y[i];
    }
    const ext = Math.max(x1 - x0, y1 - y0, 1);
    const cs = Math.max(ext / Math.max(8, Math.sqrt(n) * 2), tol * 4);
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const ax = X[seg[i][0]],
        ay = Y[seg[i][0]],
        bx = X[seg[i][1]],
        by = Y[seg[i][1]];
      const gx0 = Math.floor((Math.min(ax, bx) - tol) / cs),
        gx1 = Math.floor((Math.max(ax, bx) + tol) / cs);
      const gy0 = Math.floor((Math.min(ay, by) - tol) / cs),
        gy1 = Math.floor((Math.max(ay, by) + tol) / cs);
      for (let gx = gx0; gx <= gx1; gx++)
        for (let gy = gy0; gy <= gy1; gy++) {
          const key = gx + "," + gy,
            l = grid.get(key);
          if (l) l.push(i);
          else grid.set(key, [i]);
        }
    }
    const ayr = new Array(n).fill(null);
    const ayirEkle = (i, t, id) => {
      (ayr[i] || (ayr[i] = [])).push([t, id]);
    };
    const yakin = (px, py, k, id) => {
      const s = seg[k],
        ex = X[s[0]],
        ey = Y[s[0]],
        fx = X[s[1]] - ex,
        fy = Y[s[1]] - ey,
        l2 = fx * fx + fy * fy;
      if (!l2) return;
      const t = ((px - ex) * fx + (py - ey) * fy) / l2,
        lk = Math.sqrt(l2);
      if (t * lk <= tol || (1 - t) * lk <= tol) return;
      if (Math.hypot(px - (ex + t * fx), py - (ey + t * fy)) > tol) return;
      ayirEkle(k, t, id);
    };
    const goruldu = new Set();
    for (const l of grid.values()) {
      for (let a = 0; a < l.length; a++)
        for (let b = a + 1; b < l.length; b++) {
          const i = l[a],
            j = l[b],
            key = i * n + j;
          if (goruldu.has(key)) continue;
          goruldu.add(key);
          const s = seg[i],
            u = seg[j];
          if (s[0] === u[0] || s[0] === u[1] || s[1] === u[0] || s[1] === u[1]) continue;
          const ax = X[s[0]],
            ay = Y[s[0]],
            bx = X[s[1]],
            by = Y[s[1]],
            cx = X[u[0]],
            cy = Y[u[0]],
            dx = X[u[1]],
            dy = Y[u[1]];
          if (
            Math.max(ax, bx) + tol < Math.min(cx, dx) ||
            Math.min(ax, bx) - tol > Math.max(cx, dx) ||
            Math.max(ay, by) + tol < Math.min(cy, dy) ||
            Math.min(ay, by) - tol > Math.max(cy, dy)
          )
            continue;
          yakin(cx, cy, i, u[0]);
          yakin(dx, dy, i, u[1]);
          yakin(ax, ay, j, s[0]);
          yakin(bx, by, j, s[1]);
          const rx = bx - ax,
            ry = by - ay,
            sx = dx - cx,
            sy = dy - cy,
            den = rx * sy - ry * sx;
          if (Math.abs(den) > 1e-12) {
            const t = ((cx - ax) * sy - (cy - ay) * sx) / den,
              v = ((cx - ax) * ry - (cy - ay) * rx) / den;
            const lr = Math.hypot(rx, ry),
              ls = Math.hypot(sx, sy);
            if (t * lr > tol && (1 - t) * lr > tol && v * ls > tol && (1 - v) * ls > tol) {
              const id = dugum(ax + t * rx, ay + t * ry);
              ayirEkle(i, t, id);
              ayirEkle(j, v, id);
            }
          }
        }
    }
    const yeni = [],
      var2 = new Set();
    for (let i = 0; i < n; i++) {
      const sp = ayr[i];
      if (!sp) {
        ekle(yeni, var2, seg[i][0], seg[i][1]);
        continue;
      }
      sp.sort((p, q) => p[0] - q[0]);
      let prev = seg[i][0];
      for (const e of sp) {
        ekle(yeni, var2, prev, e[1]);
        prev = e[1];
      }
      ekle(yeni, var2, prev, seg[i][1]);
    }

    // ---- graf, budama ----
    const N = X.length;
    const adj = Array.from({ length: N }, () => []);
    for (const e of yeni) {
      adj[e[0]].push(e[1]);
      adj[e[1]].push(e[0]);
    }
    const der = adj.map((l) => l.length);
    const canli = new Uint8Array(N).fill(1);
    const acikNoktalar = [],
      sil = [];
    for (let i = 0; i < N; i++) {
      if (der[i] === 0) canli[i] = 0;
      else if (der[i] === 1) {
        sil.push(i);
        acikNoktalar.push([X[i], Y[i]]);
      }
    }
    while (sil.length) {
      const u = sil.pop();
      if (!canli[u]) continue;
      canli[u] = 0;
      for (const v of adj[u])
        if (canli[v]) {
          der[v]--;
          if (der[v] === 1) sil.push(v);
          else if (der[v] === 0) canli[v] = 0;
        }
    }
    const pos = new Array(N).fill(null);
    for (let u = 0; u < N; u++) {
      if (!canli[u]) continue;
      adj[u] = adj[u].filter((v) => canli[v]);
      adj[u].sort((a, b) => Math.atan2(Y[a] - Y[u], X[a] - X[u]) - Math.atan2(Y[b] - Y[u], X[b] - X[u]));
      pos[u] = new Map(adj[u].map((v, i) => [v, i]));
    }
    // ---- yüz izleme (yüz solda kalır, sınırlı yüzler saat yönünün tersine) ----
    const kul = new Set(),
      halkalar = [];
    const sinir = 4 * yeni.length + 10;
    for (let u = 0; u < N; u++) {
      if (!canli[u]) continue;
      for (const v0 of adj[u]) {
        if (kul.has(u * N + v0)) continue;
        const ring = [];
        let a = u,
          b = v0,
          guard = 0;
        while (!kul.has(a * N + b) && guard++ < sinir) {
          kul.add(a * N + b);
          ring.push([X[a], Y[a]]);
          const l = adj[b],
            i = pos[b].get(a),
            w = l[(i - 1 + l.length) % l.length];
          a = b;
          b = w;
        }
        if (ring.length >= 3 && alanIsaretli(ring) > 0.05) halkalar.push(ring);
      }
    }
    return { halkalar, acikUc: acikNoktalar.length, acikNoktalar };
  }

  // Önce hassas, olmazsa kademeli olarak daha büyük toleransla dener; en az açık uç bırakanı seçer.
  function yuzleriBulAdaptif(cizgiler) {
    let en = null,
      ilk = null;
    for (const tol of [0.05, 0.3, 1.0]) {
      const r = yuzleriBul(cizgiler, tol);
      r.tol = tol;
      if (!ilk) ilk = r;
      if (!en || r.acikUc < en.acikUc || (!en.halkalar.length && r.halkalar.length && r.acikUc <= en.acikUc))
        en = r;
      if (r.acikUc === 0 && r.halkalar.length) break;
    }
    en.ilkAcikUc = ilk.acikUc;
    return en;
  }

  function parcalaraAyir(halkalar) {
    // CCW'ye çevir, küçük ve tekrarlı halkaları ele
    let H = halkalar
      .map((p) => {
        let a = alanIsaretli(p);
        if (a < 0) {
          p = p.slice().reverse();
          a = -a;
        }
        return { p: sadelestirHalka(p, 0.08), alan: a };
      })
      .filter((h) => h.alan >= 1.0);
    H.forEach((h) => {
      h.kutu = kutu(h.p);
    });
    const tekrarsiz = [];
    for (const h of H) {
      const var_ = tekrarsiz.some(
        (o) =>
          Math.abs(o.alan - h.alan) < 1e-3 * Math.max(1, h.alan) &&
          Math.abs(o.kutu[0] - h.kutu[0]) < 0.1 &&
          Math.abs(o.kutu[1] - h.kutu[1]) < 0.1 &&
          Math.abs(o.kutu[2] - h.kutu[2]) < 0.1 &&
          Math.abs(o.kutu[3] - h.kutu[3]) < 0.1,
      );
      if (!var_) tekrarsiz.push(h);
    }
    H = tekrarsiz;
    for (const h of H) {
      const a = h.p[0],
        b = h.p[1];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        l = Math.hypot(dx, dy) || 1;
      h.test = [(a[0] + b[0]) / 2 - (dy / l) * 0.001, (a[1] + b[1]) / 2 + (dx / l) * 0.001];
    }
    for (const h of H) {
      h.kapsayan = [];
      for (const o of H) {
        if (o === h || o.alan <= h.alan * (1 + 1e-9) + 1e-9) continue;
        if (
          o.kutu[0] - 1e-6 > h.kutu[0] ||
          o.kutu[1] - 1e-6 > h.kutu[1] ||
          o.kutu[2] + 1e-6 < h.kutu[2] ||
          o.kutu[3] + 1e-6 < h.kutu[3]
        )
          continue;
        if (noktaHalkada(o.p, h.test[0], h.test[1])) h.kapsayan.push(o);
      }
      h.derinlik = h.kapsayan.length;
      h.ebeveyn = h.kapsayan.reduce((m, o) => (!m || o.alan < m.alan ? o : m), null);
    }
    const parcalar = [];
    for (const h of H) {
      if (h.derinlik % 2 !== 0) continue;
      const delikler = H.filter((o) => o.derinlik % 2 === 1 && o.ebeveyn === h).map((o) => o.p);
      const [x0, y0] = h.kutu;
      const kaydir = (r) => r.map((q) => [q[0] - x0, q[1] - y0]);
      const dis = kaydir(h.p),
        ic = delikler.map(kaydir);
      const alan = h.alan - delikler.reduce((s, d) => s + Math.abs(alanIsaretli(d)), 0);
      parcalar.push({ dis, delikler: ic, alan, w: h.kutu[2] - x0, h: h.kutu[3] - y0 });
    }
    return parcalar;
  }

  const DISLA =
    /(bend|b[uü]k[uü]m|bukum|fold|dim|[oö]l[cç][uü]|text|yaz[ıi]|^not|note|center|merkez|axis|eksen|hidden|gizli|hatch|tara|title|ba[sş]l[ıi]k|border|[cç]er[cç]eve|frame|anno|defpoints)/i;
  const YOKSAY = {
    HATCH: 1,
    SOLID: 1,
    TRACE: 1,
    MLINE: 1,
    REGION: 1,
    "3DSOLID": 1,
    BODY: 1,
    WIPEOUT: 1,
    IMAGE: 1,
    LEADER: 1,
  };

  // sec: { katmanlar: [seçili katman adları] | undefined, enBuyuk: bool }
  function dxfOku(metin, ad, sec) {
    sec = sec || {};
    if (typeof metin !== "string") throw new GirdiHatasi(`${ad}: dosya okunamadı.`);
    if (metin.charCodeAt(0) === 0xfeff) metin = metin.slice(1);
    if (metin.length > MAX_DOSYA_KARAKTER) throw new GirdiHatasi(`${ad}: dosya çok büyük (en fazla 8 MB).`);
    if (metin.startsWith("AutoCAD Binary DXF"))
      throw new GirdiHatasi(`${ad}: ikili (binary) DXF desteklenmiyor, metin DXF olarak kaydedin.`);
    const uyarilar = [];
    let ic;
    try {
      ic = dxfIcerik(metin);
    } catch (e) {
      if (e.kullanici) throw new GirdiHatasi(`${ad}: ${e.message}`);
      throw e;
    }
    let carpan = 1;
    if (ic.birim === 0) uyarilar.push(`${ad}: DXF'te birim tanımlı değil, milimetre varsayıldı.`);
    else if (BIRIM_CARPANI[ic.birim] === undefined)
      uyarilar.push(`${ad}: birim kodu ${ic.birim} desteklenmiyor, milimetre varsayıldı.`);
    else carpan = BIRIM_CARPANI[ic.birim];

    const sayac = { n: 0, yok: {} };
    let cc;
    try {
      cc = varliklariCoz(ic.varliklar, ic.bloklar, 0, sayac);
    } catch (e) {
      if (e.kullanici) throw new GirdiHatasi(`${ad}: ${e.message}`);
      throw e;
    }
    if (!cc.length) {
      const yoklar = Object.keys(sayac.yok)
        .map((k) => `${k} × ${sayac.yok[k]}`)
        .join(", ");
      throw new GirdiHatasi(
        `${ad}: DXF içinde çizgi, yay, daire veya polyline bulunamadı.` +
          (yoklar
            ? ` Dosyada yalnızca desteklenmeyen varlıklar var (${yoklar}); konturu polyline/çizgi olarak yeniden dışa aktarın.`
            : " Çizim paper space (düzen) sekmesinde olabilir; model sekmesine taşıyın."),
      );
    }
    if (carpan !== 1)
      cc = cc.map((pl) => ({
        kapali: pl.kapali,
        katman: pl.katman,
        pts: pl.pts.map((q) => [q[0] * carpan, q[1] * carpan]),
      }));
    for (const k of Object.keys(sayac.yok))
      uyarilar.push(`${ad}: ${k} × ${sayac.yok[k]} desteklenmediği için yok sayıldı.`);

    // ---- katmanlar ----
    const say = {};
    for (const p of cc) say[p.katman] = (say[p.katman] || 0) + 1;
    const adlar = Object.keys(say);
    const kapaliMi = (k) => !!(ic.katmanlar[k] && ic.katmanlar[k].kapali);
    let secili;
    if (sec.katmanlar) secili = new Set(sec.katmanlar.map((x) => String(x).toUpperCase()));
    else {
      secili = new Set(adlar.filter((k) => !kapaliMi(k) && !DISLA.test(k)));
      if (!secili.size) secili = new Set(adlar.filter((k) => !kapaliMi(k)));
      if (!secili.size) secili = new Set(adlar);
    }
    const katmanlar = adlar
      .map((k) => ({ ad: k, sayi: say[k], secili: secili.has(k) }))
      .sort((a, b) => b.sayi - a.sayi);
    const secilen = cc.filter((p) => secili.has(p.katman));
    if (!secilen.length)
      throw new GirdiHatasi(`${ad}: seçili katmanlarda çizim yok. En az bir katman seçin.`);

    // ---- kontur bulma ----
    let sonuc;
    try {
      sonuc = yuzleriBulAdaptif(secilen);
    } catch (e) {
      if (e.kullanici) throw new GirdiHatasi(`${ad}: ${e.message}`);
      throw e;
    }
    if (!sonuc.halkalar.length) {
      let min = null;
      const P = sonuc.acikNoktalar.slice(0, 400);
      for (let i = 0; i < P.length; i++)
        for (let j = i + 1; j < P.length; j++) {
          const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
          if (min === null || d < min) min = d;
        }
      let m = `${ad}: kapalı kontur bulunamadı (${secilen.length} çizgi/yay okundu).`;
      if (sonuc.acikNoktalar.length) {
        m +=
          ` ${sonuc.acikNoktalar.length} açık uç var` +
          (min !== null ? `, birbirine en yakın iki uç arasında ${min.toFixed(2)} mm boşluk` : "") +
          ". Konturu kapatın veya birleştirin (CAD'de JOIN / PEDIT).";
      } else m += " Çizgilerin uç uca bağlı ve kapalı olduğundan emin olun.";
      if (katmanlar.length > 1) m += " Kontur başka bir katmanda olabilir, katman seçimini kontrol edin.";
      throw new GirdiHatasi(m);
    }
    if (sonuc.tol > 0.05 && sonuc.acikUc < sonuc.ilkAcikUc)
      uyarilar.push(`${ad}: çizimdeki küçük boşluklar (en fazla ${sonuc.tol} mm) otomatik kapatıldı.`);
    if (sonuc.acikUc > 0)
      uyarilar.push(
        `${ad}: ${sonuc.acikUc} boşta çizgi ucu yok sayıldı (taşan çizgi veya eksik kontur olabilir; önizlemeyi kontrol edin).`,
      );

    let parcalar = parcalaraAyir(sonuc.halkalar);
    if (!parcalar.length) throw new GirdiHatasi(`${ad}: geçerli parça konturu üretilemedi.`);
    if (sec.enBuyuk && parcalar.length > 1) {
      parcalar.sort((a, b) => b.alan - a.alan);
      parcalar = [parcalar[0]];
    }
    return { parcalar, uyarilar, katmanlar };
  }

  // =====================================================================
  //  YERLEŞTİRME (NESTING)
  // =====================================================================
  function parcaDondur(parca, aciDeg) {
    const a = (aciDeg * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const don = (r) => r.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
    const halkalar = [don(parca.dis)].concat(parca.delikler.map(don));
    const k = kutu(halkalar[0]);
    const ox = k[0],
      oy = k[1];
    const rings = halkalar.map((r) => {
      const n = r.length;
      const xy = new Float64Array(2 * (n + 1));
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = 0; i <= n; i++) {
        const p = r[i % n];
        const x = p[0] - ox,
          y = p[1] - oy;
        xy[2 * i] = x;
        xy[2 * i + 1] = y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      return { xy, n, x0, y0, x1, y1 };
    });
    return { aci: aciDeg, w: k[2] - k[0], h: k[3] - k[1], rings };
  }

  function nktHalkada(xy, n, px, py, ox, oy) {
    let ic = false;
    for (let i = 0; i < n; i++) {
      const xi = xy[2 * i] + ox,
        yi = xy[2 * i + 1] + oy,
        xj = xy[2 * i + 2] + ox,
        yj = xy[2 * i + 3] + oy;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) ic = !ic;
    }
    return ic;
  }
  function parcadaMi(P, ox, oy, px, py) {
    if (!nktHalkada(P.rings[0].xy, P.rings[0].n, px, py, ox, oy)) return false;
    for (let i = 1; i < P.rings.length; i++)
      if (nktHalkada(P.rings[i].xy, P.rings[i].n, px, py, ox, oy)) return false;
    return true;
  }
  function nS2(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1,
      dy = y2 - y1,
      l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x1 + t * dx - px,
      qy = y1 + t * dy - py;
    return qx * qx + qy * qy;
  }
  function segMin2(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax,
      d1y = by - ay,
      d2x = dx - cx,
      d2y = dy - cy;
    const den = d1x * d2y - d1y * d2x;
    if (den !== 0) {
      const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
      const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    }
    return Math.min(
      nS2(ax, ay, cx, cy, dx, dy),
      nS2(bx, by, cx, cy, dx, dy),
      nS2(cx, cy, ax, ay, bx, by),
      nS2(dx, dy, ax, ay, bx, by),
    );
  }

  // A (ax,ay)'de, B (bx,by)'de; aralarındaki boşluk s'den azsa veya üst üste biniyorsa true
  function cakisir(A, ax, ay, B, bx, by, s) {
    const gap = Math.max(bx - (ax + A.w), ax - (bx + B.w), by - (ay + A.h), ay - (by + B.h));
    if (gap >= s) return false;
    const s2 = s * s;
    for (const ra of A.rings) {
      const rx0 = ra.x0 + ax - s,
        ry0 = ra.y0 + ay - s,
        rx1 = ra.x1 + ax + s,
        ry1 = ra.y1 + ay + s;
      for (const rb of B.rings) {
        if (rb.x1 + bx < rx0 || rb.x0 + bx > rx1 || rb.y1 + by < ry0 || rb.y0 + by > ry1) continue;
        const xa = ra.xy,
          xb = rb.xy;
        for (let i = 0; i < ra.n; i++) {
          const x1 = xa[2 * i] + ax,
            y1 = xa[2 * i + 1] + ay,
            x2 = xa[2 * i + 2] + ax,
            y2 = xa[2 * i + 3] + ay;
          const mnx = (x1 < x2 ? x1 : x2) - s,
            mxx = (x1 < x2 ? x2 : x1) + s;
          const mny = (y1 < y2 ? y1 : y2) - s,
            mxy = (y1 < y2 ? y2 : y1) + s;
          for (let k = 0; k < rb.n; k++) {
            const x3 = xb[2 * k] + bx,
              y3 = xb[2 * k + 1] + by,
              x4 = xb[2 * k + 2] + bx,
              y4 = xb[2 * k + 3] + by;
            if (
              (x3 > x4 ? x3 : x4) < mnx ||
              (x3 < x4 ? x3 : x4) > mxx ||
              (y3 > y4 ? y3 : y4) < mny ||
              (y3 < y4 ? y3 : y4) > mxy
            )
              continue;
            if (segMin2(x1, y1, x2, y2, x3, y3, x4, y4) < s2) return true;
          }
        }
      }
    }
    if (parcadaMi(B, bx, by, A.rings[0].xy[0] + ax, A.rings[0].xy[1] + ay)) return true;
    if (parcadaMi(A, ax, ay, B.rings[0].xy[0] + bx, B.rings[0].xy[1] + by)) return true;
    return false;
  }

  class Plaka {
    constructor(tipIdx, g, kenar, bosluk) {
      this.tipIdx = tipIdx;
      this.g = g;
      this.kenar = kenar;
      this.s = bosluk;
      this.yerlesik = [];
      this.alan = 0;
    }
    uygun(P, x, y) {
      const k = this.kenar;
      if (x < k - 1e-9 || y < k - 1e-9 || x + P.w > this.g.w - k + 1e-9 || y + P.h > this.g.h - k + 1e-9)
        return false;
      for (const q of this.yerlesik) if (cakisir(P, x, y, q.P, q.x, q.y, this.s)) return false;
      return true;
    }
    kaydir(P, x, y) {
      const k = this.kenar;
      for (const adim of [16, 8, 4, 2, 1, 0.5, 0.25, 0.1]) {
        for (let tur = 0; tur < 400; tur++) {
          let hareket = false;
          const nx = Math.max(x - adim, k);
          if (nx < x - 1e-9 && this.uygun(P, nx, y)) {
            x = nx;
            hareket = true;
          }
          const ny = Math.max(y - adim, k);
          if (ny < y - 1e-9 && this.uygun(P, x, ny)) {
            y = ny;
            hareket = true;
          }
          if (!hareket) break;
        }
      }
      return [x, y];
    }
    adaylar(P) {
      const k = this.kenar,
        s = this.s;
      const pts = [[k, k]];
      for (const q of this.yerlesik) {
        const x0 = q.x,
          y0 = q.y,
          x1 = q.x + q.P.w,
          y1 = q.y + q.P.h;
        pts.push([x1 + s, y0], [x0, y1 + s], [x1 + s, y1 + s], [x1 + s, k], [k, y1 + s]);
        for (let i = 1; i < q.P.rings.length; i++) {
          const r = q.P.rings[i];
          pts.push([q.x + r.x0 + s, q.y + r.y0 + s]);
        }
      }
      const gec = pts.filter(
        (p) =>
          p[0] >= k - 1e-9 &&
          p[1] >= k - 1e-9 &&
          p[0] + P.w <= this.g.w - k + 1e-9 &&
          p[1] + P.h <= this.g.h - k + 1e-9,
      );
      gec.sort((a, b) => a[0] + P.w - (b[0] + P.w) || a[1] - b[1]);
      return gec.slice(0, 500);
    }
    enIyi(tip) {
      let en = null;
      for (const P of tip.donmus) {
        if (P.w > this.g.w - 2 * this.kenar + 1e-9 || P.h > this.g.h - 2 * this.kenar + 1e-9) continue;
        for (const [x, y] of this.adaylar(P)) {
          if (this.uygun(P, x, y)) {
            const [kx, ky] = this.kaydir(P, x, y);
            const anahtar = [kx + P.w, ky];
            if (
              !en ||
              anahtar[0] < en.anahtar[0] - 1e-9 ||
              (Math.abs(anahtar[0] - en.anahtar[0]) <= 1e-9 && anahtar[1] < en.anahtar[1])
            )
              en = { anahtar, P, x: kx, y: ky };
            break;
          }
        }
      }
      return en;
    }
    ekle(tip, P, x, y) {
      this.yerlesik.push({ tip, P, x, y });
      this.alan += tip.alan;
    }
  }

  function paketle(sira, tipler, plakaTipleri, kenar, bosluk, bitis) {
    const kalan = plakaTipleri.map((p) => p.adet);
    const acik = [],
      yok = [];
    let asim = false;
    for (const ti of sira) {
      if (Date.now() > bitis) {
        asim = true;
        yok.push(ti);
        continue;
      }
      const tip = tipler[ti];
      let ok = false;
      for (const pl of acik) {
        const s = pl.enIyi(tip);
        if (s) {
          pl.ekle(tip, s.P, s.x, s.y);
          ok = true;
          break;
        }
      }
      if (!ok) {
        for (let j = 0; j < plakaTipleri.length && !ok; j++) {
          if (kalan[j] <= 0) continue;
          const yeni = new Plaka(j, plakaTipleri[j], kenar, bosluk);
          const s = yeni.enIyi(tip);
          if (s) {
            yeni.ekle(tip, s.P, s.x, s.y);
            acik.push(yeni);
            kalan[j]--;
            ok = true;
          }
        }
      }
      if (!ok) yok.push(ti);
    }
    return { acik, yok, asim };
  }

  function skorla(r) {
    const alan = r.acik.reduce((s, p) => s + p.g.w * p.g.h, 0);
    let son = 0;
    if (r.acik.length) for (const q of r.acik[r.acik.length - 1].yerlesik) son = Math.max(son, q.x + q.P.w);
    return [r.yok.length, alan, son];
  }
  function skorDaha(a, b) {
    for (let i = 0; i < 3; i++) {
      if (a[i] < b[i] - 1e-9) return true;
      if (a[i] > b[i] + 1e-9) return false;
    }
    return false;
  }

  // girdi: {dosyalar:[{ad, metin, adet}], plakalar:[{w,h,adet}], bosluk, kenar, donus, sureMs, tohum}
  function nest(girdi, ilerleme) {
    const dosyalar = girdi.dosyalar || [],
      plakalar = girdi.plakalar || [];
    const bosluk = Math.max(+girdi.bosluk || 0, 0.01),
      kenar = +girdi.kenar || 0;
    const donus = girdi.donus === undefined ? 90 : +girdi.donus;
    const sureMs = Math.min(Math.max(+girdi.sureMs || 8000, 1000), 30000);
    if (!dosyalar.length) throw new GirdiHatasi("En az bir DXF dosyası yüklemelisiniz.");
    if (dosyalar.length > 30) throw new GirdiHatasi("En fazla 30 dosya yüklenebilir.");
    if (!plakalar.length) throw new GirdiHatasi("En az bir plaka (sac) bilgisi girmelisiniz.");
    if (plakalar.length > 5) throw new GirdiHatasi("En fazla 5 farklı plaka tipi girilebilir.");
    for (const p of plakalar) {
      if (!(p.w > 0 && p.h > 0)) throw new GirdiHatasi("Plaka ölçüleri 0'dan büyük olmalı.");
      if (!(Number.isInteger(p.adet) && p.adet >= 1))
        throw new GirdiHatasi("Plaka adetleri 1 veya daha büyük tam sayı olmalı.");
    }
    if (kenar < 0 || girdi.bosluk < 0) throw new GirdiHatasi("Boşluk ve kenar payı negatif olamaz.");
    if (![0, 15, 30, 45, 90, 180].includes(donus)) throw new GirdiHatasi("Dönüş adımı geçersiz.");
    if (plakalar.some((p) => kenar * 2 >= Math.min(p.w, p.h)))
      throw new GirdiHatasi("Kenar payı plaka ölçülerine göre çok büyük.");

    const uyarilar = [];
    const tipler = [];
    const aciListesi =
      donus === 0 ? [0] : Array.from({ length: Math.floor(360 / donus) }, (_, i) => i * donus);
    let toplam = 0;
    dosyalar.forEach((d, di) => {
      if (!(Number.isInteger(d.adet) && d.adet >= 1))
        throw new GirdiHatasi(`${d.ad}: adet 1 veya daha büyük tam sayı olmalı.`);
      if (ilerleme) ilerleme({ tip: "ilerleme", mesaj: `${d.ad} okunuyor (${di + 1}/${dosyalar.length})` });
      const { parcalar, uyarilar: u } = dxfOku(d.metin, d.ad, { katmanlar: d.katmanlar, enBuyuk: d.enBuyuk });
      for (const x of u) if (!uyarilar.includes(x)) uyarilar.push(x);
      parcalar.forEach((p, i) => {
        toplam += d.adet;
        tipler.push({
          ad: parcalar.length === 1 ? d.ad : `${d.ad}#${i + 1}`,
          dosya: d.ad,
          alan: p.alan,
          adet: d.adet,
          part: p,
          donmus: aciListesi.map((a) => parcaDondur(p, a)),
        });
      });
    });
    if (toplam > MAX_TOPLAM_PARCA)
      throw new GirdiHatasi(`Toplam parça adedi ${MAX_TOPLAM_PARCA} sınırını aşıyor.`);

    const temel = [];
    tipler.forEach((t, i) => {
      for (let k = 0; k < t.adet; k++) temel.push(i);
    });
    const uzun = (t) => Math.max(t.donmus[0].w, t.donmus[0].h);
    const siralamalar = [
      temel.slice().sort((a, b) => tipler[b].alan - tipler[a].alan),
      temel.slice().sort((a, b) => uzun(tipler[b]) - uzun(tipler[a])),
    ];
    const r = rng(girdi.tohum || 1);
    const t0 = Date.now(),
      bitis = t0 + sureMs;
    let en = null,
      enAsim = false,
      deneme = 0;
    for (;;) {
      let sira;
      if (deneme < siralamalar.length) sira = siralamalar[deneme];
      else {
        sira = siralamalar[0].slice();
        const adim = Math.max(1, Math.floor(sira.length / 6));
        for (let k = 0; k < adim; k++) {
          const i = Math.floor(r() * sira.length);
          const j = Math.min(sira.length - 1, Math.max(0, i + Math.floor(r() * 9) - 4));
          const x = sira[i];
          sira[i] = sira[j];
          sira[j] = x;
        }
      }
      const baslangic = Date.now();
      const sonuc = paketle(sira, tipler, plakalar, kenar, bosluk, deneme === 0 ? t0 + sureMs * 3 : bitis);
      const sk = skorla(sonuc);
      if (!en || (!sonuc.asim && skorDaha(sk, en.sk))) {
        en = { sonuc, sk };
        enAsim = sonuc.asim;
      }
      deneme++;
      if (ilerleme)
        ilerleme({ tip: "ilerleme", mesaj: `Yerleşim denemesi ${deneme}: ${sonuc.acik.length} plaka` });
      const gecen = Date.now() - baslangic;
      if (Date.now() + gecen > bitis || deneme >= 14) break;
      if (!en.sk[0] && en.sonuc.acik.length <= 1 && deneme >= siralamalar.length) break;
    }
    const { acik, yok } = en.sonuc;
    if (enAsim) uyarilar.push("Süre sınırı aşıldı; yerleşemeyen parçalar süre yüzünden kalmış olabilir.");

    const mutlak = (q) =>
      q.P.rings.map((rg) => {
        const o = new Array(2 * rg.n);
        for (let i = 0; i < rg.n; i++) {
          o[2 * i] = rg.xy[2 * i] + q.x;
          o[2 * i + 1] = rg.xy[2 * i + 1] + q.y;
        }
        return o;
      });
    const plakaSonuc = acik.map((pl, i) => {
      let sag = 0;
      for (const q of pl.yerlesik) sag = Math.max(sag, q.x + q.P.w);
      return {
        numara: i + 1,
        tip: pl.tipIdx,
        w: pl.g.w,
        h: pl.g.h,
        ad: pl.g.ad || `${pl.g.w}x${pl.g.h}`,
        parcaSayisi: pl.yerlesik.length,
        parcaAlani: pl.alan,
        doluluk: (100 * pl.alan) / (pl.g.w * pl.g.h),
        kullanilanX: sag,
        yerlesimler: pl.yerlesik.map((q) => ({
          ad: q.tip.ad,
          aci: q.P.aci,
          x: q.x,
          y: q.y,
          halkalar: mutlak(q),
        })),
      };
    });
    const tipOzeti = plakalar.map((p, j) => ({
      ad: p.ad || `${p.w}x${p.h}`,
      w: p.w,
      h: p.h,
      eldeki: p.adet,
      kullanilan: plakaSonuc.filter((x) => x.tip === j).length,
    }));
    const yokSayac = new Map();
    for (const ti of yok) yokSayac.set(tipler[ti].ad, (yokSayac.get(tipler[ti].ad) || 0) + 1);
    const yerlesemeyen = Array.from(yokSayac, ([ad, adet]) => {
      const t = tipler.find((x) => x.ad === ad);
      const sigar = plakalar.some((p) =>
        t.donmus.some((P) => P.w <= p.w - 2 * kenar && P.h <= p.h - 2 * kenar),
      );
      return { ad, adet, neden: sigar ? "Plaka adedi yetmedi veya süre doldu." : "Parça plakaya sığmıyor." };
    });
    if (yerlesemeyen.length) uyarilar.push("Bazı parçalar yerleşemedi.");
    const toplamParca = plakaSonuc.reduce((s, p) => s + p.parcaAlani, 0);
    const toplamPlaka = plakaSonuc.reduce((s, p) => s + p.w * p.h, 0);
    return {
      plakalar: plakaSonuc,
      tipOzeti,
      yerlesemeyen,
      uyarilar,
      toplamParcaAlani: toplamParca,
      toplamPlakaAlani: toplamPlaka,
      fire: toplamPlaka ? 100 * (1 - toplamParca / toplamPlaka) : 0,
      parcaOzeti: tipler.map((t) => ({
        ad: t.ad,
        istenen: t.adet,
        delikSayisi: t.part.delikler.length,
        w: t.part.w,
        h: t.part.h,
        alan: t.part.alan,
      })),
    };
  }

  // Yerleşim sonucundan DXF (plakalar yan yana)
  function nestDxf(sonuc) {
    const v = [];
    let ofset = 0;
    for (const pl of sonuc.plakalar) {
      v.push({
        t: "poly",
        katman: "PLAKA",
        kapali: true,
        pts: [
          [ofset, 0],
          [ofset + pl.w, 0],
          [ofset + pl.w, pl.h],
          [ofset, pl.h],
        ],
      });
      const h = Math.max(Math.min(pl.w, pl.h) / 60, 5);
      v.push({
        t: "text",
        katman: "YAZI",
        x: ofset,
        y: pl.h + h,
        h,
        metin: `Plaka ${pl.numara} - ${pl.ad} - doluluk %${pl.doluluk.toFixed(1)}`,
      });
      for (const y of pl.yerlesimler)
        for (const hl of y.halkalar) {
          const pts = [];
          for (let i = 0; i < hl.length; i += 2) pts.push([hl[i] + ofset, hl[i + 1]]);
          v.push({ t: "poly", katman: "KESIM", kapali: true, pts });
        }
      ofset += pl.w + 200;
    }
    return dxfYaz(
      [
        { ad: "PLAKA", renk: 8 },
        { ad: "KESIM", renk: 7 },
        { ad: "YAZI", renk: 5 },
      ],
      v,
    );
  }

  const Cekirdek = {
    GirdiHatasi,
    ascii,
    dxfYaz,
    zipYap,
    crc32,
    boruModel,
    boruHesapla: boruModel,
    boruCizim,
    boruMesh,
    boruDxf,
    profilOptimize,
    dxfOku,
    nest,
    nestDxf,
    _iç: { cakisir, parcaDondur, segMin2, yuzleriBul, parcalaraAyir, alanIsaretli },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Cekirdek;
  else root.Cekirdek = Cekirdek;
})(typeof self !== "undefined" ? self : this);

self.onmessage = function (e) {
  try {
    var r = Cekirdek.nest(e.data, function (m) {
      self.postMessage(m);
    });
    self.postMessage({ tip: "bitti", sonuc: r });
  } catch (err) {
    self.postMessage({
      tip: "hata",
      mesaj: String((err && err.message) || err),
      kullanici: !!(err && err.kullanici),
    });
  }
};
