# yarenler-pipeline

Yarenler veri hattı (plan bölüm 10). Python 3.10 ve üstü, uv ile yönetilir.

```sh
cd pipeline
uv sync
uv run yarenler --help
uv run pytest
```

Komut biçimi: `uv run yarenler <aşama> --kurum aybu`. Aşamalar `yarenler_pipeline/cli.py` içinde tanımlanır; her aşamanın sahibi plan bölüm 9.3'te yazılıdır.

## Yayınları ham depodan yeniden ayrıştırma

`uv run yarenler avesis-yayinlar --kurum aybu` eski taramanın ham HTML'ini (`data/raw/avesis/`) yeniden okur, AVESİS'e istek atmaz. Her yayına kaynak adı (dergi, etkinlik, kitap ya da yayınevi), AVESİS yayın kimliği ve adresi, her profile de kaynak tarihi (sayfanın okunduğu an) eklenir. Diğer alanlar değişmez. Çıktı `data/avesis/aybu/profiller-yayinli.jsonl`, rapor `data/reports/<tarih>-avesis-yayinlar.md`. Yeni taramalar (`yarenler avesis`) bu alanları doğrudan yazar. Veritabanına aktarım: `apps/web/scripts/import.mjs`.
