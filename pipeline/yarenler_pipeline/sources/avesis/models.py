"""AVESİS ayrıştırıcı çıktı modelleri (kaynak kayıtları, plan 10.1 "ayrıştırma" aşaması).

İletişim alanı (e-posta, telefon, ofis, adres) hiçbir modelde yoktur.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

AYRISTIRICI_SURUMU = "avesis-0.2.0"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Uyari(_Model):
    kod: str  # rozet_uyumsuz, bilinmeyen_bolum, bilinmeyen_unvan, bos_sayfa, ...
    mesaj: str
    bolum: str | None = None


class RozetKontrolu(_Model):
    bolum: str
    rozet: int | None
    kayit: int
    uyumlu: bool


class TarihAraligi(_Model):
    ham: str
    baslangic_yil: int | None = None
    bitis_yil: int | None = None
    devam_ediyor: bool = False
    ay: str | None = None  # "Mayıs 2023" gibi tek tarihlerde ay adı


class DisKimlik(_Model):
    tur: str  # google_scholar, orcid, researcherid, yok_author, bilinmeyen
    deger: str | None
    url: str
    etiket: str


class MenuOgesi(_Model):
    href: str
    etiket: str
    sekme: str | None  # ana, egitim, ..., ya da None (iletisim, dokumanlar, indir gibi kullanılmayan)


class Baslik(_Model):
    ham: str
    unvan_metni: str | None
    unvan_kodu: str | None
    ad_ozgun: str
    ad_gorunen: str
    ad: str | None
    soyad: str | None


class OrtakBaslik(_Model):
    baslik: Baslik | None
    dis_kimlikler: list[DisKimlik] = Field(default_factory=list)
    menu: list[MenuOgesi] = Field(default_factory=list)


class Kisi(_Model):
    """Yayın, etkinlik gibi kayıtlardaki kişi (yazar, editör, görevli)."""

    sira: int
    ham_ad: str
    tam_ad: str | None = None  # AVESİS title niteliği (diğer yazarlar)
    kurum_ham: str | None = None  # popover data-content
    profil_sahibi: bool = False
    editor: bool = False
    avesis_network_user_id: str | None = None


class KurumBilgisi(_Model):
    ham: str
    fakulte: str | None = None
    bolum: str | None = None
    anabilim_dali: str | None = None


class ArastirmaAlanlari(_Model):
    avesis: list[str] = Field(default_factory=list)
    wos: list[str] = Field(default_factory=list)
    scopus: list[str] = Field(default_factory=list)


class Metrik(_Model):
    ad: str
    deger: int | None
    ham: str


class SayfaSonucu(_Model):
    sekme: str
    kaynak_url: str | None = None
    ayristirici_surumu: str = AYRISTIRICI_SURUMU
    ortak: OrtakBaslik
    rozetler: list[RozetKontrolu] = Field(default_factory=list)
    uyarilar: list[Uyari] = Field(default_factory=list)
    atilan_bolumler: list[str] = Field(default_factory=list)  # bilerek okunmayan bölümler (0.4 kararları)

    @property
    def rozet_uyumlu(self) -> bool:
        return all(r.uyumlu for r in self.rozetler)


class AnaSayfa(SayfaSonucu):
    kurum: KurumBilgisi | None = None
    arastirma_alanlari: ArastirmaAlanlari = Field(default_factory=ArastirmaAlanlari)
    metrikler: list[Metrik] = Field(default_factory=list)


class EgitimKaydi(_Model):
    tarih: TarihAraligi
    derece: str
    universite: str | None = None
    birim: str | None = None  # enstitü ya da fakülte
    bolum: str | None = None
    ulke: str | None = None
    ham: str


class TezKaydi(_Model):
    tarih: TarihAraligi
    derece: str
    baslik: str
    avesis_tez_id: str | None = None
    url: str | None = None
    kurum_ham: str | None = None


class DilKaydi(_Model):
    dil: str
    duzey_kodu: str | None = None
    duzey: str | None = None
    ham_duzey: str


class SertifikaKaydi(_Model):
    tarih: TarihAraligi
    ad: str
    alan: str | None = None
    kurum: str | None = None
    ham: str


class EgitimSayfasi(SayfaSonucu):
    egitim: list[EgitimKaydi] = Field(default_factory=list)
    tezler: list[TezKaydi] = Field(default_factory=list)
    diger: list["ListeKaydi"] = Field(default_factory=list)


class ArastirmaSayfasi(SayfaSonucu):
    arastirma_alanlari: ArastirmaAlanlari = Field(default_factory=ArastirmaAlanlari)


class GorevKaydi(_Model):
    """Akademik unvan, idari görev ya da akademi dışı deneyim."""

    bolum: str
    tarih: TarihAraligi
    baslik: str  # unvan ya da rol
    parcalar: list[str] = Field(default_factory=list)
    universite: str | None = None
    fakulte: str | None = None
    birim: str | None = None
    ham: str


class DersKaydi(_Model):
    duzey: str | None
    ad: str
    avesis_ders_id: str | None = None


class DeneyimSayfasi(SayfaSonucu):
    akademik_unvanlar: list[GorevKaydi] = Field(default_factory=list)
    idari_gorevler: list[GorevKaydi] = Field(default_factory=list)
    akademi_disi: list[GorevKaydi] = Field(default_factory=list)
    dersler: list[DersKaydi] = Field(default_factory=list)
    diger: list["ListeKaydi"] = Field(default_factory=list)


class Yayin(_Model):
    bolum: str
    tur: str  # makale, bildiri, kitap, kitap_bolumu, ansiklopedi_bolumu, diger, bilinmeyen
    sira_no: int | None = None
    avesis_yayin_id: str | None = None
    url: str | None = None
    baslik: str
    yazarlar: list[Kisi] = Field(default_factory=list)
    kaynak_ham: str = ""
    dergi: str | None = None
    kitap: str | None = None
    kitap_editorleri: list[str] = Field(default_factory=list)
    etkinlik: str | None = None
    etkinlik_tarihi: str | None = None
    yayinevi: str | None = None
    sehir: str | None = None
    ulke: str | None = None
    cilt: str | None = None
    sayi: str | None = None
    sayfa_baslangic: str | None = None
    sayfa_bitis: str | None = None
    yil: int | None = None
    indeksler: list[str] = Field(default_factory=list)
    bildiri_turu: str | None = None
    filtre_etiketleri: list[str] = Field(default_factory=list)
    openalex_id: str | None = None
    doi: str | None = None
    lisans_url: str | None = None
    avesis_tam_metin: bool = False  # /publication/showdocument/... izlenmez, yalnız varlığı not edilir
    dis_baglanti: str | None = None


class YayinlarSayfasi(SayfaSonucu):
    yayinlar: list[Yayin] = Field(default_factory=list)
    indeks_dagilimi: dict[str, int] = Field(default_factory=dict)
    metrikler: list[Metrik] = Field(default_factory=list)


class ListeKaydi(_Model):
    """Projeler, bilimsel faaliyetler, başarılar ve tanınmayan bölümler için ortak kayıt."""

    bolum: str
    tarih: TarihAraligi | None = None
    baslik: str
    baglanti: str | None = None
    avesis_kimlik: str | None = None
    tur: str | None = None
    rol: str | None = None
    kurum: str | None = None
    yer: str | None = None
    kisiler: list[Kisi] = Field(default_factory=list)
    ayrintilar: list[str] = Field(default_factory=list)


class ListeSayfasi(SayfaSonucu):
    kayitlar: list[ListeKaydi] = Field(default_factory=list)
    metrikler: list[Metrik] = Field(default_factory=list)


class TezAyrinti(_Model):
    kaynak_url: str | None = None
    ayristirici_surumu: str = AYRISTIRICI_SURUMU
    baslik: str
    yazar: Kisi | None = None
    tez_turu: str | None = None
    kurum_ham: str | None = None
    danisman: Baslik | None = None
    onay_yili: int | None = None
    dil: str | None = None
    destek_programi: str | None = None
    uyarilar: list[Uyari] = Field(default_factory=list)


EgitimSayfasi.model_rebuild()
DeneyimSayfasi.model_rebuild()


# --- 0.4 kararlarına göre birleştirilmiş profil -------------------------------------------


class Ad(_Model):
    ozgun: str  # AVESİS'teki yazım, ör. "TARIK İSMET ALKAN"
    gorunen: str  # Türkçe kurallı başlık biçimi, ör. "Örnek Araştırmacı"
    ad: str | None
    soyad: str | None


class Unvan(_Model):
    metin: str | None
    kod: str | None


class YayinOzeti(_Model):
    """Yayın özeti: eşleştirme hesabında ve profildeki yayın sayısı ile son yayınlar listesinde kullanılır."""

    baslik: str
    yil: int | None
    tur: str
    openalex_id: str | None
    doi: str | None
    yazarlar: list[str] = Field(default_factory=list)  # sıralı, AVESİS'teki yazımla
    kaynak_adi: str | None = None  # dergi, etkinlik ya da kitap/yayınevi adı (parse.yayinlar.kaynak_adi)
    avesis_yayin_id: str | None = None  # /yayin/<uuid>/... adresindeki kimlik
    avesis_url: str | None = None  # yayının AVESİS ayrıntı sayfası (mutlak adres)


class Ikincil(_Model):
    yayinlar: list[YayinOzeti] = Field(default_factory=list)
    dersler: list[str] = Field(default_factory=list)
    tez_basliklari: list[str] = Field(default_factory=list)


class Profil(_Model):
    kaynak: str = "avesis"
    ayristirici_surumu: str = AYRISTIRICI_SURUMU
    avesis_kullanici: str
    avesis_url: str
    ad: Ad | None
    unvan: Unvan
    birim: KurumBilgisi | None
    birim_kaynagi: str | None  # "ana:kurum_bilgileri" ya da "deneyim:akademik_unvan"
    orcid: str | None
    orcid_eksik: bool
    yok_author_id: str | None
    arastirma_alanlari: ArastirmaAlanlari
    ikincil: Ikincil = Field(default_factory=Ikincil)
    kaynak_tarihi: str | None = None  # kişinin AVESİS sayfalarının en son okunduğu an (ISO 8601, ham depo meta)
    rozetler: list[RozetKontrolu] = Field(default_factory=list)
    uyarilar: list[Uyari] = Field(default_factory=list)

    @property
    def rozet_uyumlu(self) -> bool:
        return all(r.uyumlu for r in self.rozetler)
