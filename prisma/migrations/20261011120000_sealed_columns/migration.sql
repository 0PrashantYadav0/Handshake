-- Trust spec §5: contract columns hold sealed values ("enc1." strings, "E1" bytes, { "sealed": ... } JSON).
-- The plaintext length checks no longer fit a ciphertext, so they move to the app (lib/deal/terms.ts, commands.ts,
-- lib/ai/schemas.ts, lib/files/validate.ts) and the database refuses any new plaintext instead.
-- NOT VALID: rows written before this migration are not re-checked; they stay readable only once sealed.

ALTER TABLE "deals"
  DROP CONSTRAINT "deals_source_text_len",
  DROP CONSTRAINT "deals_item_title_len",
  ADD CONSTRAINT "deals_source_text_sealed" CHECK ("source_text" LIKE 'enc1.%') NOT VALID,
  ADD CONSTRAINT "deals_item_title_sealed" CHECK ("item_title" LIKE 'enc1.%') NOT VALID;

ALTER TABLE "conditions"
  DROP CONSTRAINT "conditions_text_len",
  ADD CONSTRAINT "conditions_text_sealed" CHECK ("text" LIKE 'enc1.%') NOT VALID;

ALTER TABLE "evidence"
  DROP CONSTRAINT "evidence_value_len",
  ADD CONSTRAINT "evidence_value_sealed" CHECK ("value" IS NULL OR "value" LIKE 'enc1.%') NOT VALID;

-- size_bytes stays the plaintext size; the sealed bytes are longer by the header, IV and tag.
ALTER TABLE "files"
  DROP CONSTRAINT "files_size_matches_bytes",
  ADD CONSTRAINT "files_bytes_sealed" CHECK (substring("bytes" from 1 for 2) = '\x4531'::bytea AND octet_length("bytes") > "size_bytes") NOT VALID;

ALTER TABLE "verdicts"
  ADD CONSTRAINT "verdicts_reason_sealed" CHECK ("reason" LIKE 'enc1.%') NOT VALID,
  ADD CONSTRAINT "verdicts_raw_response_sealed" CHECK (jsonb_typeof("raw_response" -> 'sealed') = 'string') NOT VALID;
