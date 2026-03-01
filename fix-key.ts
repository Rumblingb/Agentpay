import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function fix() {
  const salt = '730f5f9173d631a39e48af5b8210cd87'; // From your screenshot
  const plainKey = 'sk_test_sim_12345';
  
  // This simulates the likely hashing logic: (key + salt)
  const hash = crypto.createHash('sha256').update(plainKey + salt).digest('hex');

  await prisma.merchant.update({
    where: { id: '26e7ac4f-017e-4316-bf4f-9a1b37112510' },
    data: { apiKeyHash: hash }
  });

  console.log("Database updated! Use key: sk_test_sim_12345");
}

fix();