-- Independent encrypted deletion instructions; never store plaintext subject IDs.
CREATE TABLE deletion_manifests (
  request_id TEXT PRIMARY KEY NOT NULL,
  envelope TEXT NOT NULL CHECK(length(envelope) <= 4096),
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER manifests_immutable_update BEFORE UPDATE ON deletion_manifests
BEGIN SELECT RAISE(ABORT, 'immutable_manifest'); END;
CREATE TRIGGER manifests_immutable_delete BEFORE DELETE ON deletion_manifests
BEGIN SELECT RAISE(ABORT, 'immutable_manifest'); END;
