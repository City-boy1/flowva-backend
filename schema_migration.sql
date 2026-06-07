-- ============================================================
-- FLOWVA Schema Migration — Fixed Execution Order
-- Run: npx prisma db execute --url "YOUR_DIRECT_URL" --file ./schema_migration.sql
-- ============================================================

-- Step 1: Drop Withdrawal table FIRST (it depends on PayoutMethod enum)
DROP TABLE IF EXISTS "Withdrawal";

-- Step 2: Now safely swap PayoutMethod enum
ALTER TYPE "PayoutMethod" RENAME TO "PayoutMethod_old";
CREATE TYPE "PayoutMethod" AS ENUM ('USDC_WALLET');
ALTER TABLE "PayoutSetting"
  ALTER COLUMN "primaryMethod" TYPE "PayoutMethod"
  USING "primaryMethod"::text::"PayoutMethod";
DROP TYPE "PayoutMethod_old";

-- Step 3: Clean up PayoutSetting columns
ALTER TABLE "PayoutSetting"
  DROP COLUMN IF EXISTS "momoNumber",
  DROP COLUMN IF EXISTS "momoNetwork";

-- Every creator must now have a Solana USDC address
ALTER TABLE "PayoutSetting"
  ALTER COLUMN "solanaAddress" SET NOT NULL;

-- Step 4: Rebuild CreatorWallet (display-only earnings tracker)
ALTER TABLE "CreatorWallet"
  DROP COLUMN IF EXISTS "availableBalance",
  DROP COLUMN IF EXISTS "pendingBalance",
  DROP COLUMN IF EXISTS "escrowBalance",
  DROP COLUMN IF EXISTS "currency",
  DROP COLUMN IF EXISTS "walletAddress",
  DROP COLUMN IF EXISTS "walletNetwork";

ALTER TABLE "CreatorWallet"
  ADD COLUMN IF NOT EXISTS "totalEarned" FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pending"     FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP NOT NULL DEFAULT now();

-- Step 5: Verify
SELECT column_name FROM information_schema.columns
WHERE table_name = 'CreatorWallet';