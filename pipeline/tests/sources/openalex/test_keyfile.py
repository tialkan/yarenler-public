import pytest

from yarenler_pipeline.sources.openalex import ApiKeyError, extract_key, load_api_key, strip_rtf

from yarenler_pipeline.sources.openalex.keyfile import redact

FAKE = "FAKEKEY0testonly9x8y7z6w5v4u"

def test_duz_metin_ve_etiket():
    assert extract_key(f"  {FAKE}\n") == FAKE
    assert extract_key(f"OpenAlex\napi_key = {FAKE}\n") == FAKE

def test_anahtar_yok_ya_da_cok_aday():
    with pytest.raises(ApiKeyError) as e:
        extract_key("burada anahtar yok")
    assert FAKE not in str(e.value)
    with pytest.raises(ApiKeyError) as e:
        extract_key("abcdefgh12345678xx\nzzzzzzzz87654321yy")
    assert "abcdefgh" not in str(e.value)

def test_redact():
    assert redact(f"https://x/?api_key={FAKE}&a=1", None) == "https://x/?api_key=***&a=1"
    assert FAKE not in redact(f"hata {FAKE}", FAKE)
