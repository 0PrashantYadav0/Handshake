-- AlterTable
ALTER TABLE "users" ADD COLUMN     "paypal_email_code_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paypal_email_code_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "paypal_email_code_hash" TEXT,
ADD COLUMN     "paypal_email_verified_at" TIMESTAMPTZ(6);
