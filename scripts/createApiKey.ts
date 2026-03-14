import { PrismaClient } from "@prisma/client"
import crypto from "crypto"

const prisma = new PrismaClient()

async function main() {

  // Generate an 8-hex prefix (matches Workers key_prefix lookup)
  const keyPrefix = crypto.randomBytes(4).toString("hex")

  // Secret portion (hex). Keep reasonably long.
  const secret = crypto.randomBytes(32).toString("hex")

  const rawKey = `${keyPrefix}_${secret}`

  const apiKeySalt = crypto.randomBytes(16).toString("hex")

  // Derive PBKDF2 with the same parameters as apps/api-edge (100k, sha256, 32 bytes)
  const apiKeyHash = crypto
    .pbkdf2Sync(secret, apiKeySalt, 100_000, 32, 'sha256')
    .toString('hex')

  const merchant = await prisma.merchant.create({
    data: {
      name: "Demo Merchant",
      email: `demo+${Date.now()}@agentpay.ai`,

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