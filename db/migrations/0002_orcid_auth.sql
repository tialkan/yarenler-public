-- migrate:up
CREATE TABLE orcid_session (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 orcid text NOT NULL CHECK(orcid ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
 gorunen_ad text NOT NULL,
 person_id uuid REFERENCES person(id) ON DELETE SET NULL,
 belirtec_ozeti bytea NOT NULL UNIQUE,
 bitis timestamptz NOT NULL,
 olusturma timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orcid_session_bitis_idx ON orcid_session(bitis);
-- migrate:down
DROP TABLE orcid_session;
