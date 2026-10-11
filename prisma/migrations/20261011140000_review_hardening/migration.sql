-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "rule_auto_capture_max_minor" INTEGER,
ADD COLUMN     "rule_pass_threshold" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totp_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totp_failures_since" TIMESTAMPTZ(6);
