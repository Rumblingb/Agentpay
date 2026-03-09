import { PrismaClient } from "@prisma/client"
import crypto from "crypto"

const prisma = new PrismaClient()

async function main() {

  const keyPrefix = "agp_test"

  const secret = crypto.randomBytes(24).toString("hex")

  const rawKey = `${keyPrefix}_${secret}`

  const apiKeySalt = crypto.randomBytes(16).toString("hex")

  const apiKeyHash = crypto
    .createHash("sha256")
    .update(secret + apiKeySalt)
    .digest("hex")

  const merchant = await prisma.merchant.create({
    data: {
      name: "Demo Merchant",
      email: "demo@agentpay.ai",

      keyPrefix: keyPrefix,
      apiKeySalt: apiKeySalt,
      apiKeyHash: apiKeyHash,

      walletAddress: "demo-wallet-address"
    }
  })

  console.log("Merchant created:", merchant.id)
  console.log("API KEY:", rawKey)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())