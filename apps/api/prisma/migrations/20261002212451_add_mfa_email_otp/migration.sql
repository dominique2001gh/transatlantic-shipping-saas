-- Email-based staff MFA (2026-10)
CREATE TABLE "mfa_email_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_email_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_email_otps_userId_idx" ON "mfa_email_otps"("userId");

-- AddForeignKey
ALTER TABLE "mfa_email_otps" ADD CONSTRAINT "mfa_email_otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
