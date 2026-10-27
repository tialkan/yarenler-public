-- migrate:up
CREATE TABLE person_collaboration_area (
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 area_id uuid NOT NULL REFERENCES research_area(id) ON DELETE CASCADE,
 added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(person_id,area_id)
);
CREATE VIEW person_matching_area AS
 SELECT person_id,area_id,false AS interest FROM person_research_area
 UNION ALL SELECT person_id,area_id,true AS interest FROM person_collaboration_area;
-- migrate:down
DROP VIEW person_matching_area;
DROP TABLE person_collaboration_area;
