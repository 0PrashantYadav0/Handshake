-- CreateEnum
CREATE TYPE "deal_status" AS ENUM ('draft', 'terms_agreed', 'held', 'proof_submitted', 'in_review', 'captured', 'paid', 'voided');

-- CreateEnum
CREATE TYPE "evidence_type" AS ENUM ('photo', 'tracking');

-- CreateEnum
CREATE TYPE "file_purpose" AS ENUM ('reference', 'evidence');

-- CreateEnum
CREATE TYPE "evidence_kind" AS ENUM ('photo', 'tracking', 'note');

-- CreateEnum
CREATE TYPE "verdict_result" AS ENUM ('pass', 'fail', 'unclear');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('created', 'approved', 'authorized', 'capture_pending', 'captured', 'declined', 'voided');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('pending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "event_actor" AS ENUM ('buyer', 'seller', 'system', 'paypal', 'ai');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "paypal_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "public_code" TEXT NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID,
    "source_text" TEXT NOT NULL,
    "item_title" TEXT NOT NULL,
    "amount_minor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "deadline_days" INTEGER,
    "deadline_at" TIMESTAMPTZ(6),
    "status" "deal_status" NOT NULL DEFAULT 'draft',
    "terms_version" INTEGER NOT NULL DEFAULT 1,
    "buyer_accepted_version" INTEGER,
    "seller_accepted_version" INTEGER,
    "fix_attempts_used" INTEGER NOT NULL DEFAULT 0,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conditions" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "evidence_type" "evidence_type" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "purpose" "file_purpose" NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "submission_no" INTEGER NOT NULL,
    "kind" "evidence_kind" NOT NULL,
    "position" INTEGER NOT NULL,
    "file_id" UUID,
    "value" TEXT,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verdicts" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "condition_id" UUID NOT NULL,
    "submission_no" INTEGER NOT NULL,
    "result" "verdict_result" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "raw_response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "paypal_order_id" TEXT NOT NULL,
    "order_attempts" INTEGER NOT NULL DEFAULT 0,
    "authorization_id" TEXT,
    "authorized_at" TIMESTAMPTZ(6),
    "auth_expires_at" TIMESTAMPTZ(6),
    "capture_id" TEXT,
    "capture_attempts" INTEGER NOT NULL DEFAULT 0,
    "status" "payment_status" NOT NULL DEFAULT 'created',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "sender_batch_id" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paypal_batch_id" TEXT,
    "paypal_item_id" TEXT,
    "status" "payout_status" NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_events" (
    "id" BIGSERIAL NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_status" "deal_status",
    "to_status" "deal_status" NOT NULL,
    "actor" "event_actor" NOT NULL,
    "cause" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "paypal_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "body" JSONB NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("paypal_event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "deals_public_code_key" ON "deals"("public_code");

-- CreateIndex
CREATE INDEX "deals_buyer_id_status_idx" ON "deals"("buyer_id", "status");

-- CreateIndex
CREATE INDEX "deals_seller_id_status_idx" ON "deals"("seller_id", "status");

-- CreateIndex
CREATE INDEX "deals_status_deadline_at_idx" ON "deals"("status", "deadline_at");

-- CreateIndex
CREATE INDEX "deals_status_updated_at_idx" ON "deals"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "conditions_deal_id_position_key" ON "conditions"("deal_id", "position");

-- CreateIndex
CREATE INDEX "files_deal_id_purpose_idx" ON "files"("deal_id", "purpose");

-- CreateIndex
CREATE INDEX "evidence_deal_id_submission_no_idx" ON "evidence"("deal_id", "submission_no");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_deal_id_submission_no_kind_position_key" ON "evidence"("deal_id", "submission_no", "kind", "position");

-- CreateIndex
CREATE INDEX "verdicts_deal_id_submission_no_idx" ON "verdicts"("deal_id", "submission_no");

-- CreateIndex
CREATE UNIQUE INDEX "verdicts_condition_id_submission_no_key" ON "verdicts"("condition_id", "submission_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_deal_id_key" ON "payments"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paypal_order_id_key" ON "payments"("paypal_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_authorization_id_key" ON "payments"("authorization_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_capture_id_key" ON "payments"("capture_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_sender_batch_id_key" ON "payouts"("sender_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_paypal_batch_id_key" ON "payouts"("paypal_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_paypal_item_id_key" ON "payouts"("paypal_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_deal_id_attempt_key" ON "payouts"("deal_id", "attempt");

-- CreateIndex
CREATE INDEX "deal_events_deal_id_id_idx" ON "deal_events"("deal_id", "id");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
