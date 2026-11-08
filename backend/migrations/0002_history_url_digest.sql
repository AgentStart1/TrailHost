-- Keep full URLs in the table without putting unbounded text in a B-tree.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE history_entries
    ADD COLUMN url_sha256 BYTEA GENERATED ALWAYS AS (digest(url, 'sha256')) STORED;

ALTER TABLE history_entries
    DROP CONSTRAINT history_entries_user_id_url_visit_time_key,
    ADD CONSTRAINT history_entries_user_url_digest_visit_key
        UNIQUE (user_id, url_sha256, visit_time);
