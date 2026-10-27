-- migrate:up
ALTER TABLE research_area_suggestion ADD COLUMN applied_automatically boolean NOT NULL DEFAULT false;
CREATE TABLE profile_field_review (
 person_id uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
 reviewed_at timestamptz NOT NULL DEFAULT now()
);
-- migrate:down
DROP TABLE profile_field_review;
ALTER TABLE research_area_suggestion DROP COLUMN applied_automatically;
