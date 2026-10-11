-- CreateEnum
CREATE TYPE "party_role" AS ENUM ('buyer', 'seller');

-- CreateTable
CREATE TABLE "signing_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "x" TEXT NOT NULL,
    "y" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_signatures" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "party_role" NOT NULL,
    "terms_version" INTEGER NOT NULL,
    "contract_hash" TEXT NOT NULL,
    "key_id" UUID NOT NULL,
    "signature" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signing_keys_fingerprint_key" ON "signing_keys"("fingerprint");

-- CreateIndex
CREATE INDEX "signing_keys_user_id_idx" ON "signing_keys"("user_id");

-- CreateIndex
CREATE INDEX "contract_signatures_key_id_idx" ON "contract_signatures"("key_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_signatures_deal_id_role_terms_version_key" ON "contract_signatures"("deal_id", "role", "terms_version");

-- AddForeignKey
ALTER TABLE "signing_keys" ADD CONSTRAINT "signing_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "signing_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- trust spec §6: shape checks, and signatures are evidence, so they are append-only like deal_events.
ALTER TABLE "signing_keys"
  ADD CONSTRAINT "signing_keys_fingerprint_hex" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "signing_keys_xy_b64url" CHECK ("x" ~ '^[A-Za-z0-9_-]{43}$' AND "y" ~ '^[A-Za-z0-9_-]{43}$');

ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_hash_hex" CHECK ("contract_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "contract_signatures_sig_b64url" CHECK ("signature" ~ '^[A-Za-z0-9_-]{86}$'),
  ADD CONSTRAINT "contract_signatures_version_positive" CHECK ("terms_version" > 0);

CREATE FUNCTION contract_signatures_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'contract_signatures is append-only (% rejected)', TG_OP;
END;
$$;

CREATE TRIGGER contract_signatures_no_update_delete
  BEFORE UPDATE OR DELETE ON "contract_signatures"
  FOR EACH ROW EXECUTE FUNCTION contract_signatures_append_only();
