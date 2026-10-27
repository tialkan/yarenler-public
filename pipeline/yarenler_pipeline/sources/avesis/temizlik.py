"""İletişim bilgisinin ayıklanması. dl#contactList hiçbir zaman saklanmaz, ayrıştırılmaz (avesis-yapi.md)."""

from __future__ import annotations

import re

from selectolax.lexbor import LexborHTMLParser

ILETISIM_SECICILERI = ("dl#contactList", 'a[href^="mailto:"]', 'a[href^="tel:"]')

_DL = re.compile(r"<dl\b[^>]*\bid\s*=\s*[\"']?contactList\b.*?</dl\s*>", re.S | re.I)
_MAILTO = re.compile(r"<a\b[^>]*href\s*=\s*[\"']?(?:mailto|tel):.*?</a\s*>", re.S | re.I)


def iletisim_temizle(html: str) -> str:
    """Ham HTML'den iletişim bloğunu ve mailto/tel bağlantılarını metin düzeyinde siler.

    Ham dosya biçimini korumak için düzenli ifade kullanılır; ardından ayrıştırıcıyla bir kez daha denetlenir.
    """
    temiz = _MAILTO.sub("", _DL.sub("", html))
    agac = LexborHTMLParser(temiz)
    if any(agac.css_first(s) is not None for s in ILETISIM_SECICILERI):
        for s in ILETISIM_SECICILERI:
            for n in agac.css(s):
                n.decompose()
        temiz = agac.html or ""
    return temiz


def agactan_iletisimi_sil(agac: LexborHTMLParser) -> None:
    for s in ILETISIM_SECICILERI:
        for n in agac.css(s):
            n.decompose()
