from yarenler_pipeline.sources.openalex import abstract_from_inverted_index

from yarenler_pipeline.sources.openalex.models import Work

def test_basit_siralama():
    idx = {"dünya": [1], "Merhaba": [0], "güzel": [2, 4], "ve": [3]}
    assert abstract_from_inverted_index(idx) == "Merhaba dünya güzel ve güzel"

def test_bos_ve_eksik():
    assert abstract_from_inverted_index(None) is None
    assert abstract_from_inverted_index({}) is None
    assert abstract_from_inverted_index({"x": []}) is None

def test_konum_boslugu_atlanir():
    assert abstract_from_inverted_index({"a": [0], "c": [5]}) == "a c"
