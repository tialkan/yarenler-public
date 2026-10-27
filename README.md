# Yarenler

Yarenler, araştırmacıların çalışma alanlarına göre potansiyel akademik işbirliklerini keşfetmesine yardımcı olan web uygulamasıdır. Bu depo uygulamanın kaynak kodunu ve sürekli bütünleştirme kontrollerini içerir.

Uygulama Next.js, PostgreSQL ve Python veri hattından oluşur. TR Dizin, OpenAlex ve AVESİS erişimi ilgili kaynakların güncel kullanım koşullarına ve bağımsız yapılandırmaya bağlıdır. Depoda gerçek üretim verisi, erişim anahtarları, özel operasyon belgeleri ve gerçek kişi test örnekleri bulunması amaçlanmaz. Kaynak tarama, ayrıştırma, güvenlik ve yayın işleme testleri kurgusal profil, kurum ve yayın örnekleri kullanır.

## Yerel geliştirme

Node.js 24, Python 3.10 veya üzeri, uv ve PostgreSQL 18/pgvector gerekir. `npm install` ve `uv sync --project pipeline` ile bağımlılıkları kurun. Ortam değişkenleri için `.env.example` dosyasını inceleyin. Gerçek anahtarları veya kişisel verileri Git'e eklemeyin.

```sh
npm --workspace apps/web run typecheck
npm --workspace apps/web run lint
npm --workspace apps/web test
uv run --project pipeline pytest pipeline/tests -q
npm --workspace apps/web run build
```

Bu depo için henüz bir açık kaynak lisansı belirlenmemiştir. Marka, logolar, üçüncü taraf fontlar ve görseller ayrı haklara tabi olabilir; bunların varlığı yeniden kullanım yetkisi vermez. Font lisansları ilgili dosyalarla birlikte sunulmaktadır.

## Dağıtım ve kontroller

`main` dalındaki değişiklikler GitHub Actions ile doğrulanır ve Coolify yapılandırmasındaki public kaynak üzerinden dağıtılır. Uygulama kapsayıcısı, dağıtım sırasında bekleyen veritabanı göçlerini ayrı bir göç bağlantısıyla uygular. Üretim sırları, veri tabanı kayıtları ve özel yedekler depoya eklenmez.
