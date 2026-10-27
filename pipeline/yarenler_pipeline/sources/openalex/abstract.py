"""OpenAlex ters indeksinden (abstract_inverted_index) özet metni üretimi."""

from __future__ import annotations

from collections.abc import Mapping, Sequence


def abstract_from_inverted_index(
    inverted_index: Mapping[str, Sequence[int]] | None,
) -> str | None:
    """Ters indeksi düz metne çevirir.

    OpenAlex özeti ``{"kelime": [konum, ...]}`` biçiminde verir. Her kelime
    konumlarına yerleştirilir, boşlukla birleştirilir. Boş ya da eksik indeks
    için ``None`` döner (uydurma metin üretilmez). Konum boşlukları atlanır.
    Türkçe karakterler olduğu gibi korunur.
    """
    if not inverted_index:
        return None
    positions: dict[int, str] = {}
    for word, idxs in inverted_index.items():
        for i in idxs or ():
            if isinstance(i, int) and i >= 0 and i not in positions:
                positions[i] = word
    if not positions:
        return None
    text = " ".join(positions[i] for i in sorted(positions))
    text = text.strip()
    return text or None
