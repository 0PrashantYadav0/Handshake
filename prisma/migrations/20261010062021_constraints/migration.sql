-- prisma/migrations/<timestamp>_constraints/migration.sql

-- users
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lower" CHECK ("email" = lower(btrim("email")) AND position('@' in "email") > 1);

-- deals
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_public_code_format"
    CHECK ("public_code" ~ '^HS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  ADD CONSTRAINT "deals_currency_usd" CHECK ("currency" = 'USD'),
  ADD CONSTRAINT "deals_amount_range"
    CHECK ("amount_minor" IS NULL OR "amount_minor" BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "deals_deadline_days_range"
    CHECK ("deadline_days" IS NULL OR "deadline_days" BETWEEN 1 AND 21),
  ADD CONSTRAINT "deals_terms_version_min" CHECK ("terms_version" >= 1),
  ADD CONSTRAINT "deals_buyer_accepted_range"
    CHECK ("buyer_accepted_version" IS NULL OR "buyer_accepted_version" BETWEEN 1 AND "terms_version"),
  ADD CONSTRAINT "deals_seller_accepted_range"
    CHECK ("seller_accepted_version" IS NULL OR "seller_accepted_version" BETWEEN 1 AND "terms_version"),
  ADD CONSTRAINT "deals_fix_attempts_range" CHECK ("fix_attempts_used" IN (0, 1)),
  ADD CONSTRAINT "deals_source_text_len" CHECK (char_length("source_text") BETWEEN 1 AND 500),
  ADD CONSTRAINT "deals_item_title_len" CHECK (char_length("item_title") BETWEEN 1 AND 80),
  ADD CONSTRAINT "deals_parties_differ" CHECK ("seller_id" IS NULL OR "seller_id" <> "buyer_id"),
  ADD CONSTRAINT "deals_complete_after_draft" CHECK (
    "status" IN ('draft', 'voided')
    OR ("seller_id" IS NOT NULL AND "amount_minor" IS NOT NULL AND "deadline_days" IS NOT NULL)),
  ADD CONSTRAINT "deals_deadline_at_after_held" CHECK (
    "status" IN ('draft', 'terms_agreed', 'voided') OR "deadline_at" IS NOT NULL);

-- conditions
ALTER TABLE "conditions"
  ADD CONSTRAINT "conditions_position_range" CHECK ("position" BETWEEN 1 AND 5),
  ADD CONSTRAINT "conditions_text_len" CHECK (char_length("text") BETWEEN 1 AND 200);

-- files
ALTER TABLE "files"
  ADD CONSTRAINT "files_mime_allowed" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "files_size_range" CHECK ("size_bytes" BETWEEN 1 AND 2097152),
  ADD CONSTRAINT "files_size_matches_bytes" CHECK ("size_bytes" = octet_length("bytes")),
  ADD CONSTRAINT "files_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- evidence
ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_submission_no_range" CHECK ("submission_no" IN (1, 2)),
  ADD CONSTRAINT "evidence_kind_shape" CHECK (
    ("kind" = 'photo' AND "file_id" IS NOT NULL AND "value" IS NULL AND "position" BETWEEN 1 AND 6)
    OR ("kind" IN ('tracking', 'note') AND "file_id" IS NULL AND "value" IS NOT NULL AND "position" = 0)),
  ADD CONSTRAINT "evidence_value_len" CHECK ("value" IS NULL OR char_length("value") BETWEEN 1 AND 1000);

-- verdicts
ALTER TABLE "verdicts"
  ADD CONSTRAINT "verdicts_submission_no_range" CHECK ("submission_no" IN (1, 2)),
  ADD CONSTRAINT "verdicts_confidence_range" CHECK ("confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "verdicts_reason_nonempty" CHECK (char_length("reason") >= 1);

-- payments
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_order_attempts_min" CHECK ("order_attempts" >= 0),
  ADD CONSTRAINT "payments_capture_attempts_min" CHECK ("capture_attempts" >= 0),
  ADD CONSTRAINT "payments_auth_pair" CHECK (("authorization_id" IS NULL) = ("authorized_at" IS NULL)),
  ADD CONSTRAINT "payments_auth_before_status"
    CHECK ("authorization_id" IS NOT NULL OR "status" IN ('created', 'approved')),
  ADD CONSTRAINT "payments_capture_id_with_status"
    CHECK ("capture_id" IS NOT NULL OR "status" NOT IN ('capture_pending', 'captured', 'declined'));

-- payouts
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_attempt_min" CHECK ("attempt" >= 1),
  ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "payouts_currency_usd" CHECK ("currency" = 'USD'),
  ADD CONSTRAINT "payouts_failure_reason" CHECK ("status" <> 'failed' OR "failure_reason" IS NOT NULL);

-- deal_events: shape checks and the append-only rule
ALTER TABLE "deal_events"
  ADD CONSTRAINT "deal_events_cause_nonempty" CHECK (char_length("cause") >= 1),
  ADD CONSTRAINT "deal_events_payload_object" CHECK (jsonb_typeof("payload") = 'object');

CREATE FUNCTION deal_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'deal_events is append-only (% rejected)', TG_OP;
END
$$;

CREATE TRIGGER deal_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "deal_events"
  FOR EACH ROW EXECUTE FUNCTION deal_events_append_only();

-- webhook_events
ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_processed_only_if_verified" CHECK ("processed_at" IS NULL OR "verified");
