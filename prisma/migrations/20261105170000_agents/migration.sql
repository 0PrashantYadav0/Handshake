-- CreateTable
CREATE TABLE "agent_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_hint" TEXT NOT NULL,
    "max_amount_minor" INTEGER NOT NULL,
    "signing_jwk" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "agent_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "last_run_at" TIMESTAMPTZ(6) NOT NULL,
    "errors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_keys_token_hash_key" ON "agent_keys"("token_hash");

-- CreateIndex
CREATE INDEX "agent_keys_user_id_idx" ON "agent_keys"("user_id");

-- AddForeignKey
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
