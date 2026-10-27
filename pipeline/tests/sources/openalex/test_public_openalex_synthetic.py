from yarenler_pipeline.sources.openalex import Work

def test_synthetic_work_without_personal_data():
    work = Work.from_api({"id": "https://openalex.org/W1"})
    assert work.id == "W1" and work.authorships == []
