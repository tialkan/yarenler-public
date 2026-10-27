"""API anahtarını dosyadan okuma.

Anahtar ``OPENALEX_API_KEY_FILE`` ortam değişkeninin gösterdiği dosyadan
okunur. Dosya RTF ise (macOS TextEdit sık üretir) biçimlendirme atılır ve
anahtar deseni çıkarılır. Anahtar hiçbir yerde loglanmaz, istisna
mesajlarına yazılmaz.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

ENV_VAR = "OPENALEX_API_KEY_FILE"

# OpenAlex anahtar biçimi belgelenmemiştir. Bu yüzden genel bir desen
# kullanılır: harf, rakam, alt çizgi ve tireden oluşan, en az 16 karakterlik,
# en az bir rakam içeren kesintisiz dizi.
_KEY_RE = re.compile(r"(?<![A-Za-z0-9_\-])([A-Za-z0-9][A-Za-z0-9_\-]{15,})(?![A-Za-z0-9_\-])")


class ApiKeyError(RuntimeError):
    """Anahtar okunamadı. Mesaj anahtarın kendisini asla içermez."""


def strip_rtf(text: str) -> str:
    """RTF biçimlendirmesini kaba ama güvenli biçimde atar.

    Yalnız düz metin parçaları kalır: kontrol sözcükleri (``\\rtf1``,
    ``\\f0`` ...), ``\\'xx`` kaçışları ve yıldızlı ya da tablo grupları
    (``{\\fonttbl ...}``, ``{\\colortbl ...}``, ``{\\*\\...}``) çıkarılır.
    """
    if not text.lstrip().startswith("{\\rtf"):
        return text
    out: list[str] = []
    skip_depth: int | None = None
    depth = 0
    i = 0
    n = len(text)
    destinations = (
        "fonttbl", "colortbl", "stylesheet", "info", "expandedcolortbl",
        "pict", "header", "footer", "listtable", "listoverridetable",
    )
    while i < n:
        ch = text[i]
        if ch == "{":
            depth += 1
            i += 1
            if skip_depth is None:
                m = re.match(r"\\\*|\\([a-z]+)", text[i:])
                if m and (m.group(0) == "\\*" or m.group(1) in destinations):
                    skip_depth = depth
            continue
        if ch == "}":
            if skip_depth is not None and depth == skip_depth:
                skip_depth = None
            depth -= 1
            i += 1
            continue
        if ch == "\\":
            nxt = text[i + 1 : i + 2]
            if nxt in ("\\", "{", "}"):
                if skip_depth is None:
                    out.append(nxt)
                i += 2
                continue
            if nxt == "'":
                i += 4  # \'xx
                continue
            if nxt in ("\n", "\r"):
                if skip_depth is None:
                    out.append("\n")
                i += 2
                continue
            m = re.match(r"\\([a-zA-Z]+)(-?\d+)? ?", text[i:])
            if m:
                if skip_depth is None and m.group(1) in ("par", "line"):
                    out.append("\n")
                i += m.end()
                continue
            i += 2
            continue
        if skip_depth is None and ch not in "\r\n":
            out.append(ch)
        i += 1
    return "".join(out)


def extract_key(raw: str) -> str:
    """Ham dosya içeriğinden anahtarı çıkarır (RTF ya da düz metin)."""
    text = strip_rtf(raw)
    candidates = [m.group(1) for m in _KEY_RE.finditer(text)]
    candidates = [c for c in candidates if any(ch.isdigit() for ch in c)]
    # "api_key=..." gibi bir etiket varsa etiketten sonraki adayı tercih et
    labelled = re.search(r"api[_ ]?key\s*[:=]\s*([A-Za-z0-9_\-]{16,})", text, re.I)
    if labelled:
        return labelled.group(1)
    unique = list(dict.fromkeys(candidates))
    if len(unique) == 1:
        return unique[0]
    if not unique:
        raise ApiKeyError("Anahtar dosyasında anahtar deseni bulunamadı.")
    raise ApiKeyError(
        f"Anahtar dosyasında {len(unique)} aday var; tek anahtar bekleniyordu."
    )


def load_api_key(env: dict[str, str] | None = None) -> str | None:
    """``OPENALEX_API_KEY_FILE`` tanımlıysa anahtarı döndürür, değilse ``None``.

    ``None`` anahtarsız (paylaşılan IP bütçesi) çalışma demektir.
    """
    env = os.environ if env is None else env
    path = env.get(ENV_VAR)
    if not path:
        return None
    p = Path(path).expanduser()
    try:
        raw = p.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ApiKeyError(f"Anahtar dosyası okunamadı ({type(exc).__name__}).") from None
    return extract_key(raw)


def redact(text: str, key: str | None) -> str:
    """Metindeki anahtarı maskeler (log ve hata mesajları için)."""
    if key:
        text = text.replace(key, "***")
    return re.sub(r"(api_key=)[^&\s]+", r"\1***", text)
