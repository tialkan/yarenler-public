-- migrate:up
CREATE TABLE person_identifier_resolution (
 person_id uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
 orcid text UNIQUE CHECK(orcid IS NULL OR orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
 source_url text NOT NULL CHECK(source_url LIKE 'https://pub.orcid.org/%'),
 evidence jsonb NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now()
);
-- migrate:down
DROP TABLE person_identifier_resolution;
