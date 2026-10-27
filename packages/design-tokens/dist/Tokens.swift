// Yarenler tasarım belirteçleri v0.1.0. Bu dosya üretilir, elle düzenlemeyin. Kaynak: tokens.json
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public enum YRTokens {
  public enum ColorLight {
    /// Sayfa zemini. Kâğıt hissi veren sıcak krem.
    public static let bg = Color(.sRGB, red: 0.9804, green: 0.9608, blue: 0.9255, opacity: 1)
    /// Kart, sekme çubuğu, giriş kutusu yüzeyi.
    public static let surface = Color(.sRGB, red: 1.0000, green: 0.9882, blue: 0.9647, opacity: 1)
    /// İkinci düzey yüzey: seçili görünüm, monogram zemini.
    public static let surface2 = Color(.sRGB, red: 0.9490, green: 0.9176, blue: 0.8627, opacity: 1)
    /// Ana metin rengi.
    public static let text = Color(.sRGB, red: 0.1686, green: 0.1294, blue: 0.1020, opacity: 1)
    /// İkincil metin: birim adı, veri günü, açıklama. Metin için AA geçer.
    public static let textMuted = Color(.sRGB, red: 0.4000, green: 0.3412, blue: 0.2902, opacity: 1)
    /// Ayraç çizgisi. Yalnız süsleyici ayrım içindir, bilgi taşımaz.
    public static let border = Color(.sRGB, red: 0.8863, green: 0.8392, blue: 0.7686, opacity: 1)
    /// Bilgi taşıyan çizgi: halka izi, düğüm çerçevesi, ikincil düğme kenarı. Zemine karşı en az 3:1.
    public static let line = Color(.sRGB, red: 0.5490, green: 0.4784, blue: 0.4078, opacity: 1)
    /// Tek vurgu rengi (kiremit kor). Birincil düğme, bağlantı, etkin sekme.
    public static let accent = Color(.sRGB, red: 0.6902, green: 0.2471, blue: 0.1098, opacity: 1)
    /// Vurgu, üzerine gelme ve basılı hali.
    public static let accentHover = Color(.sRGB, red: 0.5765, green: 0.2000, blue: 0.0745, opacity: 1)
    /// Vurgu zemini üstündeki metin.
    public static let onAccent = Color(.sRGB, red: 1.0000, green: 1.0000, blue: 1.0000, opacity: 1)
    /// Odak halkası rengi. 3 px, 2 px boşlukla çizilir.
    public static let focus = Color(.sRGB, red: 0.1686, green: 0.1294, blue: 0.1020, opacity: 1)
    /// Ilık bant dolgusu (45-64). Dış halka.
    public static let heatIlik = Color(.sRGB, red: 0.9569, green: 0.8392, blue: 0.7373, opacity: 1)
    /// Ilık bant üstündeki metin.
    public static let heatOnIlik = Color(.sRGB, red: 0.1686, green: 0.1294, blue: 0.1020, opacity: 1)
    /// Sıcak bant dolgusu (65-84). Orta halka.
    public static let heatSicak = Color(.sRGB, red: 0.8941, green: 0.5412, blue: 0.3686, opacity: 1)
    /// Sıcak bant üstündeki metin.
    public static let heatOnSicak = Color(.sRGB, red: 0.1686, green: 0.1294, blue: 0.1020, opacity: 1)
    /// Kor bant dolgusu (85-100). İç halka.
    public static let heatKor = Color(.sRGB, red: 0.6902, green: 0.2471, blue: 0.1098, opacity: 1)
    /// Kor bant üstündeki metin.
    public static let heatOnKor = Color(.sRGB, red: 1.0000, green: 1.0000, blue: 1.0000, opacity: 1)
  }

  public enum ColorDark {
    /// Sayfa zemini. Sıcak, kahveye çalan koyu ton.
    public static let bg = Color(.sRGB, red: 0.1059, green: 0.0863, blue: 0.0706, opacity: 1)
    /// Kart, sekme çubuğu, giriş kutusu yüzeyi.
    public static let surface = Color(.sRGB, red: 0.1451, green: 0.1176, blue: 0.0980, opacity: 1)
    /// İkinci düzey yüzey: seçili görünüm, monogram zemini.
    public static let surface2 = Color(.sRGB, red: 0.1882, green: 0.1529, blue: 0.1216, opacity: 1)
    /// Ana metin rengi.
    public static let text = Color(.sRGB, red: 0.9490, green: 0.9137, blue: 0.8667, opacity: 1)
    /// İkincil metin: birim adı, veri günü, açıklama. Metin için AA geçer.
    public static let textMuted = Color(.sRGB, red: 0.7333, green: 0.6627, blue: 0.5843, opacity: 1)
    /// Ayraç çizgisi. Yalnız süsleyici ayrım içindir, bilgi taşımaz.
    public static let border = Color(.sRGB, red: 0.2431, green: 0.2039, blue: 0.1686, opacity: 1)
    /// Bilgi taşıyan çizgi: halka izi, düğüm çerçevesi, ikincil düğme kenarı. Zemine karşı en az 3:1.
    public static let line = Color(.sRGB, red: 0.5569, green: 0.4863, blue: 0.4196, opacity: 1)
    /// Tek vurgu rengi (kiremit kor). Birincil düğme, bağlantı, etkin sekme.
    public static let accent = Color(.sRGB, red: 0.9412, green: 0.5412, blue: 0.3647, opacity: 1)
    /// Vurgu, üzerine gelme ve basılı hali.
    public static let accentHover = Color(.sRGB, red: 0.9647, green: 0.6431, blue: 0.4980, opacity: 1)
    /// Vurgu zemini üstündeki metin.
    public static let onAccent = Color(.sRGB, red: 0.1059, green: 0.0863, blue: 0.0706, opacity: 1)
    /// Odak halkası rengi. 3 px, 2 px boşlukla çizilir.
    public static let focus = Color(.sRGB, red: 0.9490, green: 0.9137, blue: 0.8667, opacity: 1)
    /// Ilık bant dolgusu (45-64). Dış halka.
    public static let heatIlik = Color(.sRGB, red: 0.2941, green: 0.2078, blue: 0.1569, opacity: 1)
    /// Ilık bant üstündeki metin.
    public static let heatOnIlik = Color(.sRGB, red: 0.9490, green: 0.9137, blue: 0.8667, opacity: 1)
    /// Sıcak bant dolgusu (65-84). Orta halka.
    public static let heatSicak = Color(.sRGB, red: 0.6196, green: 0.2980, blue: 0.1686, opacity: 1)
    /// Sıcak bant üstündeki metin.
    public static let heatOnSicak = Color(.sRGB, red: 0.9686, green: 0.9333, blue: 0.8941, opacity: 1)
    /// Kor bant dolgusu (85-100). İç halka.
    public static let heatKor = Color(.sRGB, red: 0.9412, green: 0.5412, blue: 0.3647, opacity: 1)
    /// Kor bant üstündeki metin.
    public static let heatOnKor = Color(.sRGB, red: 0.1059, green: 0.0863, blue: 0.0706, opacity: 1)
  }

  /// Açık ve karanlık temaya kendiliğinden uyan renkler.
  public enum Colors {
    /// Sayfa zemini. Kâğıt hissi veren sıcak krem.
    public static let bg = YRTokens.dynamic(light: "#FAF5EC", dark: "#1B1612")
    /// Kart, sekme çubuğu, giriş kutusu yüzeyi.
    public static let surface = YRTokens.dynamic(light: "#FFFCF6", dark: "#251E19")
    /// İkinci düzey yüzey: seçili görünüm, monogram zemini.
    public static let surface2 = YRTokens.dynamic(light: "#F2EADC", dark: "#30271F")
    /// Ana metin rengi.
    public static let text = YRTokens.dynamic(light: "#2B211A", dark: "#F2E9DD")
    /// İkincil metin: birim adı, veri günü, açıklama. Metin için AA geçer.
    public static let textMuted = YRTokens.dynamic(light: "#66574A", dark: "#BBA995")
    /// Ayraç çizgisi. Yalnız süsleyici ayrım içindir, bilgi taşımaz.
    public static let border = YRTokens.dynamic(light: "#E2D6C4", dark: "#3E342B")
    /// Bilgi taşıyan çizgi: halka izi, düğüm çerçevesi, ikincil düğme kenarı. Zemine karşı en az 3:1.
    public static let line = YRTokens.dynamic(light: "#8C7A68", dark: "#8E7C6B")
    /// Tek vurgu rengi (kiremit kor). Birincil düğme, bağlantı, etkin sekme.
    public static let accent = YRTokens.dynamic(light: "#B03F1C", dark: "#F08A5D")
    /// Vurgu, üzerine gelme ve basılı hali.
    public static let accentHover = YRTokens.dynamic(light: "#933313", dark: "#F6A47F")
    /// Vurgu zemini üstündeki metin.
    public static let onAccent = YRTokens.dynamic(light: "#FFFFFF", dark: "#1B1612")
    /// Odak halkası rengi. 3 px, 2 px boşlukla çizilir.
    public static let focus = YRTokens.dynamic(light: "#2B211A", dark: "#F2E9DD")
    /// Ilık bant dolgusu (45-64). Dış halka.
    public static let heatIlik = YRTokens.dynamic(light: "#F4D6BC", dark: "#4B3528")
    /// Ilık bant üstündeki metin.
    public static let heatOnIlik = YRTokens.dynamic(light: "#2B211A", dark: "#F2E9DD")
    /// Sıcak bant dolgusu (65-84). Orta halka.
    public static let heatSicak = YRTokens.dynamic(light: "#E48A5E", dark: "#9E4C2B")
    /// Sıcak bant üstündeki metin.
    public static let heatOnSicak = YRTokens.dynamic(light: "#2B211A", dark: "#F7EEE4")
    /// Kor bant dolgusu (85-100). İç halka.
    public static let heatKor = YRTokens.dynamic(light: "#B03F1C", dark: "#F08A5D")
    /// Kor bant üstündeki metin.
    public static let heatOnKor = YRTokens.dynamic(light: "#FFFFFF", dark: "#1B1612")
  }

  public enum HeatBandKor {
    /// Kor alt sınırı.
    public static let min: Int = 85
    public static let max: Int = 100
  }

  public enum HeatBandSicak {
    /// Sıcak alt sınırı.
    public static let min: Int = 65
    public static let max: Int = 84
  }

  public enum HeatBandIlik {
    /// Ilık alt sınırı.
    public static let min: Int = 45
    public static let max: Int = 64
  }

  public enum FontWeight {
    public static let regular: CGFloat = 400
    public static let medium: CGFloat = 500
    /// Başlık ve vurgu ağırlığı.
    public static let semibold: CGFloat = 600
  }

  public enum FontSize {
    /// Etiket, veri günü.
    public static let xs: CGFloat = 12
    /// Yardımcı metin.
    public static let sm: CGFloat = 14
    /// Gövde metni, mobil.
    public static let md: CGFloat = 16
    /// Gövde metni, masaüstü; giriş kutusu.
    public static let lg: CGFloat = 18
    /// Alt başlık.
    public static let xl: CGFloat = 22
    /// Bölüm başlığı, büyük sayı.
    public static let f2xl: CGFloat = 28
    /// Ekran başlığı, mobil.
    public static let f3xl: CGFloat = 38
    /// Ekran başlığı, masaüstü.
    public static let f4xl: CGFloat = 52
    /// Ana sayfa manşeti, masaüstü.
    public static let f5xl: CGFloat = 72
  }

  public enum FontLineHeight {
    /// Büyük serif başlık.
    public static let tight: CGFloat = 1.05
    public static let snug: CGFloat = 1.25
    /// Gövde metni.
    public static let body: CGFloat = 1.55
  }

  public enum FontLetterSpacing {
    /// Büyük başlıkta hafif sıkılaştırma.
    public static let display: CGFloat = -0.02 // em, yazı boyuyla çarpılır
    /// Büyük harfli küçük etiket.
    public static let label: CGFloat = 0.08 // em, yazı boyuyla çarpılır
  }

  public enum Space {
    public static let s0: CGFloat = 0
    public static let s1: CGFloat = 4
    public static let s2: CGFloat = 8
    public static let s3: CGFloat = 12
    /// Mobil yan boşluk.
    public static let s4: CGFloat = 16
    public static let s5: CGFloat = 20
    public static let s6: CGFloat = 24
    public static let s8: CGFloat = 32
    public static let s10: CGFloat = 40
    public static let s12: CGFloat = 48
    public static let s16: CGFloat = 64
    /// Bölümler arası, masaüstü.
    public static let s20: CGFloat = 80
  }

  public enum Size {
    /// En küçük dokunma hedefi (WCAG ve Apple HIG).
    public static let touchTarget: CGFloat = 44
    /// Ana arama kutusu yüksekliği.
    public static let inputHeight: CGFloat = 56
    /// Odak halkası kalınlığı.
    public static let focusRing: CGFloat = 3
    /// Odak halkası boşluğu.
    public static let focusOffset: CGFloat = 2
  }

  public enum Radius {
    public static let none: CGFloat = 0
    /// Rozet kutusu, görünüm geçişi.
    public static let sm: CGFloat = 8
    /// Düğme, arama kutusu, kart.
    public static let md: CGFloat = 12
    /// Alt sayfa, büyük panel.
    public static let lg: CGFloat = 20
    /// Çip, monogram, bant etiketi.
    public static let full: CGFloat = 999
  }

  public enum MotionDuration {
    /// Basılı geri bildirimi.
    public static let instant: TimeInterval = 0.08
    /// Üzerine gelme, odak.
    public static let fast: TimeInterval = 0.14
    /// Tema, sekme, çip geçişi.
    public static let base: TimeInterval = 0.22
    /// Liste ile Halka arası geçiş.
    public static let slow: TimeInterval = 0.36
    /// Halkanın dışa doğru açılması.
    public static let ring: TimeInterval = 0.7
  }

  public enum FontFamily {
    /// Başlık ailesi. iOS büyük başlıklarda da kullanılır.
    public static let serif: [String] = ["Fraunces", "Georgia", "serif"]
    /// Metin ailesi. iOS metinde sistem fontu ve Dynamic Type kullanır.
    public static let sans: [String] = ["IBM Plex Sans", "Segoe UI", "system-ui", "sans-serif"]
    /// Kod ve kimlik gösterimi.
    public static let mono: [String] = ["ui-monospace", "SF Mono", "Menlo", "monospace"]
  }

  static func dynamic(light: String, dark: String) -> Color {
    #if canImport(UIKit)
    return Color(uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark ? uiColor(dark) : uiColor(light)
    })
    #else
    return color(light)
    #endif
  }

  static func components(_ hex: String) -> (Double, Double, Double, Double) {
    var s = hex; if s.hasPrefix("#") { s.removeFirst() }
    let v = UInt64(s, radix: 16) ?? 0
    if s.count == 8 {
      return (Double((v >> 24) & 0xFF) / 255, Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
    }
    return (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255, 1)
  }

  static func color(_ hex: String) -> Color {
    let c = components(hex)
    return Color(.sRGB, red: c.0, green: c.1, blue: c.2, opacity: c.3)
  }

  #if canImport(UIKit)
  static func uiColor(_ hex: String) -> UIColor {
    let c = components(hex)
    return UIColor(red: c.0, green: c.1, blue: c.2, alpha: c.3)
  }
  #endif
}
