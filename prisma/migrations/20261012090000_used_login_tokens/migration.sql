-- CreateTable
CREATE TABLE "used_login_tokens" (
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "used_login_tokens_pkey" PRIMARY KEY ("jti")
);
