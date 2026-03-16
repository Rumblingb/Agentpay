-- CreateTable
CREATE TABLE IF NOT EXISTS "agentrank_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "grade" TEXT NOT NULL DEFAULT 'U',
    "payment_reliability" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "service_delivery" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "transaction_volume" INTEGER NOT NULL DEFAULT 0,
    "wallet_age_days" INTEGER NOT NULL DEFAULT 0,
    "dispute_rate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "stake_usdc" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unique_counterparties" INTEGER NOT NULL DEFAULT 0,
    "factors" JSONB DEFAULT '{}',
    "history" JSONB DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agentrank_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agentrank_scores_agent_id_key" ON "agentrank_scores"("agent_id");
