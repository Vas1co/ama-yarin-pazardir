/* Ama Yarın Pazardır - site ayarları. Yayına almadan önce aşağıdaki alanları kendi bilgilerinizle doldurun. */
window.AYARLAR = {
  site: "Ama Yarın Pazardır",
  surum: "1.8.1",
  surumTarih: "1 Kasım 2026",
  // Reklam: client = AdSense yayıncı numarası. aktif: AdSense onayı gelince true yapılır.
  // aktif false iken sitede reklam alanı, çerez bildirimi, reklam kodu ve reklam engelleyici uyarısı yoktur;
  // yalnızca AdSense'in sahiplik doğrulaması için meta etiketi ve ads.txt yayınlanır.
  adsense: {
    client: "",
    aktif: false,
    yuvalar: { ust: "", kare: "", alt: "", gecis: "" }, // her yuva için AdSense reklam birimi numarası
  },
  // Geçiş reklamı varsayılan olarak KAPALI. AdSense politikaları, devam etmek için reklam izletmeyi
  // kısıtlar; açmak yerine AdSense panelinden "Geçiş (vignette) reklamları"nı açmanız önerilir.
  gecisReklam: false,
  gecisHer: 2,
  gecisSn: 5,
};
