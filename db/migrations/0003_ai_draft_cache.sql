-- migrate:up
CREATE TABLE ai_draft_cache (
 cache_key text PRIMARY KEY,
 person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
 response jsonb NOT NULL,
 expires timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE INDEX ai_draft_cache_expires_idx ON ai_draft_cache(expires);
-- migrate:down
DROP TABLE ai_draft_cache;
