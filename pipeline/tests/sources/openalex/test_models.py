from yarenler_pipeline.sources.openalex import AYBU_OPENALEX_ID, Author, Institution, Topic, Work

def test_select_ile_daraltilmis_kayit():
    w = Work.from_api({"id": "https://openalex.org/W1"})
    assert w.id == "W1" and w.abstract is None and w.authorships == []
