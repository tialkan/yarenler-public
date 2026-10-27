-- migrate:up
CREATE TABLE research_evidence (
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 5 AND 2000),
 year smallint, source_url text NOT NULL CHECK(source_url LIKE 'https://avesis.aybu.edu.tr/%'),
 digest text NOT NULL, PRIMARY KEY(person_id,digest)
);
CREATE TABLE person_semantic (
 person_id uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
 embedding vector(384) NOT NULL, model text NOT NULL, input_digest text NOT NULL,
 evidence jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE research_area_suggestion (
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 area_id uuid NOT NULL REFERENCES research_area(id) ON DELETE CASCADE,
 similarity real NOT NULL CHECK(similarity BETWEEN -1 AND 1),
 evidence jsonb NOT NULL, model text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(person_id,area_id)
);
-- migrate:down
DROP TABLE research_area_suggestion,person_semantic,research_evidence;
