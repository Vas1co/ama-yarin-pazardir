# Görselleri yeni markaya çevirir (bağımlılıksız, Windows .NET System.Drawing).
#  - og/*.jpg   : turuncu -> kobalt renk dönüşümü, sol panel yeni marka ve başlıkla yeniden yazılır
#  - og/site.jpg: logo + "Ama Yarın Pazardır" kapak görseli
#  - blog/*.png : turuncu -> kobalt, sağ alttaki eski alan adı yenisiyle değiştirilir
#  - ikonlar    : favicon.ico, ikon-48/192/512.png, apple-touch-icon.png
# Kullanım:  powershell -ExecutionPolicy Bypass -File araclar\gorseller.ps1
# DİKKAT: Renk dönüşümü turuncu kaynak görseller içindir; zaten dönüşmüş görsellerde tekrar çalıştırmak zararsızdır
# (mavi tonlara dokunmaz) ama sol panel/alan adı yeniden yazılır.

$ErrorActionPreference = 'Stop'
$kok = Split-Path -Parent $PSScriptRoot
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;

public static class Marka {
    public const string Ad = "Ama Yarın Pazardır";
    public const string Alan = "ama-yarin-pazardir.peekdock.com";
    static readonly Color Kobalt = Color.FromArgb(22, 56, 212);
    static readonly Color Cyan = Color.FromArgb(137, 220, 235);
    static readonly Color Mor = Color.FromArgb(167, 139, 250);
    static readonly Color Ink = Color.FromArgb(11, 15, 23);
    static readonly Color Mut = Color.FromArgb(90, 107, 140);
    static readonly Color Zemin = Color.FromArgb(240, 245, 255);

    // ---- renk dönüşümü: turuncu tonlar (hue 8-45) kobalt tonuna (hue ~229) döner, açıklık/doygunluk korunur
    static void RgbToHsl(int r, int g, int b, out double h, out double s, out double l) {
        double R = r / 255.0, G = g / 255.0, B = b / 255.0;
        double max = Math.Max(R, Math.Max(G, B)), min = Math.Min(R, Math.Min(G, B));
        l = (max + min) / 2; h = 0; s = 0;
        if (max == min) return;
        double d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max == R) h = (G - B) / d + (G < B ? 6 : 0); else if (max == G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
        h *= 60;
    }
    static double Hue2(double p, double q, double t) {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1.0 / 6) return p + (q - p) * 6 * t; if (t < 0.5) return q; if (t < 2.0 / 3) return p + (q - p) * (2.0 / 3 - t) * 6; return p;
    }
    static void HslToRgb(double h, double s, double l, out int r, out int g, out int b) {
        h /= 360; double q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        r = (int)Math.Round(Hue2(p, q, h + 1.0 / 3) * 255); g = (int)Math.Round(Hue2(p, q, h) * 255); b = (int)Math.Round(Hue2(p, q, h - 1.0 / 3) * 255);
    }
    public static void Renklendir(Bitmap bmp) {
        Rectangle rc = new Rectangle(0, 0, bmp.Width, bmp.Height);
        BitmapData bd = bmp.LockBits(rc, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int n = bd.Stride * bmp.Height; byte[] px = new byte[n];
        Marshal.Copy(bd.Scan0, px, 0, n);
        for (int i = 0; i < n; i += 4) {
            int b = px[i], g = px[i + 1], r = px[i + 2];
            // eski gri zemin (#e9edf0 civarı) -> buz mavisi
            if (Math.Abs(r - 233) < 5 && Math.Abs(g - 237) < 5 && Math.Abs(b - 240) < 5) { px[i] = Zemin.B; px[i + 1] = Zemin.G; px[i + 2] = Zemin.R; continue; }
            double h, s, l; RgbToHsl(r, g, b, out h, out s, out l);
            if (s < 0.18 || h < 6 || h > 48) continue;
            int nr, ng, nb; HslToRgb(229, Math.Min(1, s * 1.05), l, out nr, out ng, out nb);
            px[i] = (byte)Math.Max(0, Math.Min(255, nb)); px[i + 1] = (byte)Math.Max(0, Math.Min(255, ng)); px[i + 2] = (byte)Math.Max(0, Math.Min(255, nr));
        }
        Marshal.Copy(px, 0, bd.Scan0, n);
        bmp.UnlockBits(bd);
    }

    static Graphics Hazirla(Bitmap bmp) {
        Graphics g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        return g;
    }
    static GraphicsPath Yuvarlak(RectangleF r, float rad) {
        GraphicsPath p = new GraphicsPath(); float d = rad * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure(); return p;
    }
    // Logo: 34 birimlik SVG ile aynı çizim, (x,y) konumunda 'boy' piksel
    public static void Logo(Graphics g, float x, float y, float boy, bool kosesiz) {
        float k = boy / 34f;
        RectangleF r = new RectangleF(x, y, boy, boy);
        using (LinearGradientBrush lg = new LinearGradientBrush(new PointF(x, y), new PointF(x + boy, y + boy), Kobalt, Color.FromArgb(79, 107, 255)))
        using (GraphicsPath yp = kosesiz ? null : Yuvarlak(r, 9 * k)) {
            if (kosesiz) g.FillRectangle(lg, r); else g.FillPath(lg, yp);
        }
        Func<float, float, PointF> P = (a, b) => new PointF(x + a * k, y + b * k);
        using (GraphicsPath s = new GraphicsPath()) {
            s.AddBezier(P(16, 7), P(16.8f, 12.6f), P(19.9f, 15.7f), P(25.5f, 16.5f));
            s.AddBezier(P(25.5f, 16.5f), P(19.9f, 17.3f), P(16.8f, 20.4f), P(16, 26));
            s.AddBezier(P(16, 26), P(15.2f, 20.4f), P(12.1f, 17.3f), P(6.5f, 16.5f));
            s.AddBezier(P(6.5f, 16.5f), P(12.1f, 15.7f), P(15.2f, 12.6f), P(16, 7));
            s.CloseFigure(); g.FillPath(Brushes.White, s);
        }
        using (SolidBrush cb = new SolidBrush(Cyan)) g.FillEllipse(cb, x + 24.5f * k, y + 6 * k, 4 * k, 4 * k);
    }
    static void Serit(Graphics g, int h) {
        using (LinearGradientBrush lg = new LinearGradientBrush(new Point(0, 0), new Point(0, h), Kobalt, Cyan)) {
            ColorBlend cb = new ColorBlend(); cb.Colors = new Color[] { Kobalt, Mor, Cyan }; cb.Positions = new float[] { 0, 0.55f, 1 };
            lg.InterpolationColors = cb; g.FillRectangle(lg, 0, 0, 18, h);
        }
    }
    static void Pus(Graphics g, float cx, float cy, float rad, Color c, int alfa) {
        using (GraphicsPath p = new GraphicsPath()) {
            p.AddEllipse(cx - rad, cy - rad, rad * 2, rad * 2);
            using (PathGradientBrush pb = new PathGradientBrush(p)) {
                pb.CenterColor = Color.FromArgb(alfa, c); pb.SurroundColors = new Color[] { Color.FromArgb(0, c) };
                g.FillPath(pb, p);
            }
        }
    }
    static float Sar(Graphics g, string metin, Font f, Brush b, float x, float y, float gen) {
        StringFormat sf = new StringFormat(StringFormat.GenericTypographic); sf.Trimming = StringTrimming.Word;
        SizeF olc = g.MeasureString(metin, f, (int)gen, sf);
        g.DrawString(metin, f, b, new RectangleF(x, y, gen, olc.Height + 4), sf);
        return olc.Height;
    }
    static void JpgKaydet(Bitmap bmp, string yol) {
        ImageCodecInfo jpg = null; foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpg = c;
        EncoderParameters ep = new EncoderParameters(1); ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 90L);
        bmp.Save(yol, jpg, ep);
    }
    static Bitmap Yukle(string yol) {
        using (FileStream fs = new FileStream(yol, FileMode.Open, FileAccess.Read)) using (Image im = Image.FromStream(fs)) {
            Bitmap b = new Bitmap(im.Width, im.Height, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(b)) g.DrawImage(im, 0, 0, im.Width, im.Height);
            return b;
        }
    }

    // ---- sayfa OG görseli: sağdaki çizim kartı korunur, sol panel yeniden yazılır
    public static void OgSayfa(string yol, string etiket, string baslik) {
        using (Bitmap bmp = Yukle(yol)) {
            Renklendir(bmp);
            using (Graphics g = Hazirla(bmp)) {
                using (SolidBrush z = new SolidBrush(Zemin)) g.FillRectangle(z, 0, 0, 636, bmp.Height);
                Pus(g, 80, 40, 260, Mor, 40);
                Serit(g, bmp.Height);
                using (Font fe = new Font("Segoe UI", 21, FontStyle.Bold, GraphicsUnit.Pixel))
                using (SolidBrush be = new SolidBrush(Kobalt)) g.DrawString(etiket, fe, be, 68, 58);
                float boy = 66; Font fb = null; float h = 0;
                using (Graphics olcer = Graphics.FromImage(new Bitmap(1, 1))) {
                    while (true) {
                        fb = new Font("Segoe UI", boy, FontStyle.Bold, GraphicsUnit.Pixel);
                        h = olcer.MeasureString(baslik, fb, 540).Height;
                        if (h <= boy * 1.36f * 3 || boy <= 40) break;
                        fb.Dispose(); boy -= 4;
                    }
                }
                using (SolidBrush bi = new SolidBrush(Ink)) Sar(g, baslik, fb, bi, 66, 104, 540);
                fb.Dispose();
                Logo(g, 68, 506, 44, false);
                using (Font fm = new Font("Segoe UI", 25, FontStyle.Bold, GraphicsUnit.Pixel))
                using (Font fa = new Font("Segoe UI", 20, FontStyle.Regular, GraphicsUnit.Pixel))
                using (SolidBrush bi = new SolidBrush(Ink)) using (SolidBrush bm = new SolidBrush(Mut)) {
                    g.DrawString(Ad, fm, bi, 122, 500); g.DrawString(Alan, fa, bm, 123, 531);
                }
            }
            JpgKaydet(bmp, yol + ".tmp");
        }
        File.Delete(yol); File.Move(yol + ".tmp", yol);
    }

    // ---- ana kapak (og/site.jpg)
    public static void OgSite(string yol) {
        using (Bitmap bmp = Yukle(yol)) {
            Renklendir(bmp);
            using (Graphics g = Hazirla(bmp)) {
                using (SolidBrush z = new SolidBrush(Zemin)) g.FillRectangle(z, 0, 0, 640, bmp.Height);
                Pus(g, 120, 60, 300, Mor, 42);
                Serit(g, bmp.Height);
                Logo(g, 70, 60, 112, false);
                using (Font fb = new Font("Segoe UI", 86, FontStyle.Bold, GraphicsUnit.Pixel))
                using (SolidBrush bi = new SolidBrush(Ink)) {
                    g.DrawString("Ama Yarın", fb, bi, 60, 186); g.DrawString("Pazardır", fb, bi, 60, 286);
                }
                using (Font fs = new Font("Segoe UI", 27, FontStyle.Regular, GraphicsUnit.Pixel))
                using (SolidBrush bm = new SolidBrush(Mut)) {
                    g.DrawString("Sac açılım · Profil boy kesim", fs, bm, 68, 418);
                    g.DrawString("Sac yerleşim · Ağırlık · Dişli", fs, bm, 68, 456);
                }
                using (Font fk = new Font("Segoe UI", 23, FontStyle.Bold, GraphicsUnit.Pixel))
                using (SolidBrush bk = new SolidBrush(Kobalt)) {
                    g.DrawString("Ücretsiz · Kayıt yok", fk, bk, 68, 524);
                    g.DrawString(Alan, fk, bk, 68, 558);
                }
            }
            JpgKaydet(bmp, yol + ".tmp");
        }
        File.Delete(yol); File.Move(yol + ".tmp", yol);
    }

    // ---- rehber çizimi: renk dönüşümü + sağ alt alan adı
    public static void Blog(string yol) {
        using (Bitmap bmp = Yukle(yol)) {
            Renklendir(bmp);
            using (Graphics g = Hazirla(bmp)) {
                g.FillRectangle(Brushes.White, bmp.Width - 330, bmp.Height - 34, 330, 34);
                using (Font fa = new Font("Segoe UI", 17, FontStyle.Regular, GraphicsUnit.Pixel))
                using (SolidBrush bm = new SolidBrush(Mut)) {
                    StringFormat sf = new StringFormat(); sf.Alignment = StringAlignment.Far;
                    g.DrawString(Alan, fa, bm, new RectangleF(bmp.Width - 330, bmp.Height - 31, 300, 26), sf);
                }
            }
            bmp.Save(yol + ".tmp", ImageFormat.Png);
        }
        File.Delete(yol); File.Move(yol + ".tmp", yol);
    }

    // ---- ikonlar
    static byte[] IkonPng(int boy, bool kosesiz) {
        using (Bitmap b = new Bitmap(boy, boy, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Hazirla(b)) { g.Clear(Color.Transparent); Logo(g, 0, 0, boy, kosesiz); }
            using (MemoryStream ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); return ms.ToArray(); }
        }
    }
    public static void Ikonlar(string kok) {
        File.WriteAllBytes(Path.Combine(kok, "ikon-48.png"), IkonPng(48, false));
        File.WriteAllBytes(Path.Combine(kok, "ikon-192.png"), IkonPng(192, false));
        File.WriteAllBytes(Path.Combine(kok, "ikon-512.png"), IkonPng(512, false));
        File.WriteAllBytes(Path.Combine(kok, "apple-touch-icon.png"), IkonPng(180, true)); // iOS köşeleri kendisi yuvarlar
        int[] boylar = { 16, 32, 48 }; byte[][] pngs = new byte[3][];
        for (int i = 0; i < 3; i++) pngs[i] = IkonPng(boylar[i], false);
        using (MemoryStream ms = new MemoryStream()) using (BinaryWriter w = new BinaryWriter(ms)) {
            w.Write((short)0); w.Write((short)1); w.Write((short)3);
            int ofs = 6 + 16 * 3;
            for (int i = 0; i < 3; i++) {
                w.Write((byte)boylar[i]); w.Write((byte)boylar[i]); w.Write((byte)0); w.Write((byte)0);
                w.Write((short)1); w.Write((short)32); w.Write(pngs[i].Length); w.Write(ofs); ofs += pngs[i].Length;
            }
            for (int i = 0; i < 3; i++) w.Write(pngs[i]);
            File.WriteAllBytes(Path.Combine(kok, "favicon.ico"), ms.ToArray());
        }
    }
}
'@

$pub = Join-Path $kok 'public'
$liste = Get-Content (Join-Path $PSScriptRoot 'og-listesi.tsv') -Encoding UTF8
foreach ($satir in $liste) {
    $p = $satir -split "`t"
    [Marka]::OgSayfa((Join-Path $pub "og\$($p[0])"), $p[1], $p[2])
}
[Marka]::OgSite((Join-Path $pub 'og\site.jpg'))
Get-ChildItem (Join-Path $pub 'blog\*.png') | ForEach-Object { [Marka]::Blog($_.FullName) }
[Marka]::Ikonlar($pub)
"OG: $($liste.Count + 1)  Blog: $((Get-ChildItem (Join-Path $pub 'blog\*.png')).Count)  İkonlar: 5"
