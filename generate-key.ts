import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
// Import your actual hashing logic if you can find it in your project
// If not, we will use the app's createMerchant logic

const prisma = new PrismaClient();

async function generate() {
  const plainKey = `sk_test_${crypto.randomBytes(20).toString('hex')}`;
  const salt = crypto.randomBytes(16).toString('hex');
  
  // Replace this with the EXACT hashing logic found in your 
  // src/routes/merchants.ts or services/auth.ts
  const hash = crypto.createHash('sha256').update(plainKey + salt).digest('hex');

  await prisma.merchant.update({
    where: { id: '26e7ac4f-017e-4316-bf4f-9a1b37112510' },
    data: { 
      apiKeyHash: hash,
      apiKeySalt: salt,
      keyPrefix: 'sk_test_'
    }
  });

  console.log("New Valid Key Generated:");
  console.log(plainKey);
}

generate();