-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "api_key_salt" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "webhook_url" TEXT,
    "stripe_connected_account_id" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "merchant_id" UUID,
    "display_name" TEXT NOT NULL,
    "public_key" TEXT,
    "risk_score" INTEGER NOT NULL DEFAULT 500,
    "service" TEXT,
    "endpoint_url" TEXT,
    "pricing_model" JSONB DEFAULT '{}',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "total_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_transactions" (
    "id" TEXT NOT NULL,
    "buyer_agent_id" TEXT NOT NULL,
    "seller_agent_id" TEXT NOT NULL,
    "task" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DOUBLE PRECISION NOT NULL,
    "escrow_id" TEXT,
    "output" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_escrow" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'locked',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_reputation_network" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "success_rate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "dispute_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "avg_response_time" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "total_tx" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_reputation_network_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "agent_id" UUID,
    "amount" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "protocol" TEXT,
    "verification_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID,
    "ip_address" TEXT,
    "transaction_signature" TEXT,
    "endpoint" TEXT,
    "method" TEXT,
    "succeeded" BOOLEAN,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_usdc" DECIMAL(20,6) NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "payer_address" TEXT,
    "transaction_hash" TEXT,
    "stripe_payment_reference" TEXT,
    "status" TEXT DEFAULT 'pending',
    "webhook_status" TEXT DEFAULT 'not_sent',
    "confirmation_depth" INTEGER DEFAULT 0,
    "required_depth" INTEGER DEFAULT 2,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hiring_agent" TEXT NOT NULL,
    "working_agent" TEXT NOT NULL,
    "amount_usdc" DECIMAL(20,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'funded',
    "work_description" TEXT,
    "deadline" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "reputation_delta_hiring" INTEGER NOT NULL DEFAULT 0,
    "reputation_delta_working" INTEGER NOT NULL DEFAULT 0,
    "dispute_reason" TEXT,
    "guilty_party" TEXT,
    "escrow_account_pubkey" TEXT,
    "transaction_signature" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavior_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "description" TEXT,
    "auto_paused" BOOLEAN NOT NULL DEFAULT false,
    "reputation_penalty" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavior_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" TEXT NOT NULL,
    "owner_email" TEXT NOT NULL,
    "owner_id" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "kyc_status" TEXT NOT NULL DEFAULT 'pending',
    "risk_score" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "stripe_account" TEXT,
    "platform_token" TEXT,
    "world_id_hash" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_pool" (
    "id" SERIAL NOT NULL,
    "current_balance_usdc" DECIMAL(20,6) NOT NULL,
    "max_coverage_per_tx" DECIMAL(20,6) NOT NULL DEFAULT 100.00,
    "total_claims" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "escrow_id" TEXT NOT NULL,
    "hiring_agent" TEXT NOT NULL,
    "working_agent" TEXT NOT NULL,
    "amount_usdc" DECIMAL(20,6) NOT NULL,
    "evidence" JSONB DEFAULT '{}',
    "completion_score" DECIMAL(5,3),
    "peer_reviews" JSONB DEFAULT '[]',
    "outcome" TEXT,
    "worker_payout" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "hirer_refund" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "encrypted_private_key" TEXT NOT NULL,
    "balance_usdc" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_email_key" ON "merchants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agent_reputation_network_agent_id_key" ON "agent_reputation_network"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_verification_token_key" ON "payment_intents"("verification_token");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_payment_id_key" ON "transactions"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_identities_agent_id_key" ON "agent_identities"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_wallets_agent_id_key" ON "agent_wallets"("agent_id");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
