#!/usr/bin/env node
import { createHash } from 'node:crypto';
import casperSdk from 'casper-js-sdk';

const { HttpHandler, KeyAlgorithm, PrivateKey, RpcClient, makeCsprTransferDeploy } = casperSdk;

const env = process.env;
const rpcUrl = env.CASPER_RPC_URL || 'https://node.testnet.casper.network/rpc';
const chainName = env.CASPER_CHAIN_NAME || 'casper-test';
const amountMotes = env.CASPER_AMOUNT_MOTES || '100000000';
const paymentMotes = env.CASPER_PAYMENT_MOTES || '100000000';
const receiptId = env.BEE_CASPER_RECEIPT_ID || `bee-${Date.now()}`;
let privateHex = env.CASPER_PRIVATE_KEY_HEX;
let recipientHex = env.CASPER_RECIPIENT_PUBLIC_KEY_HEX;
const keyAlgorithm = (env.CASPER_KEY_ALGORITHM || 'ED25519').toUpperCase() === 'SECP256K1'
  ? KeyAlgorithm.SECP256K1
  : KeyAlgorithm.ED25519;
const dryRun = process.argv.includes('--dry-run');

function usage() {
  console.error(`Usage:
  CASPER_PRIVATE_KEY_HEX=<hex> \\
  CASPER_RECIPIENT_PUBLIC_KEY_HEX=<public-key-hex> \\
  BEE_CASPER_RECEIPT_ID=<bee-mandate-or-receipt-id> \\
  npm --prefix ops/mac-mini/bee/casper run receipt

Optional:
  CASPER_RPC_URL=${rpcUrl}
  CASPER_CHAIN_NAME=${chainName}
  CASPER_KEY_ALGORITHM=ED25519|SECP256K1
  CASPER_AMOUNT_MOTES=${amountMotes}
  CASPER_PAYMENT_MOTES=${paymentMotes}

Use --dry-run to build the signed transfer metadata without broadcasting.`);
}

function transferIdFor(value) {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 12), 16);
}

if (dryRun && (!privateHex || !recipientHex)) {
  const demoKey = await PrivateKey.generate(keyAlgorithm);
  privateHex = Buffer.from(demoKey.toBytes()).toString('hex');
  recipientHex = demoKey.publicKey.toHex();
}

if (!privateHex || !recipientHex) {
  usage();
  process.exit(2);
}

const privateKey = await PrivateKey.fromHex(privateHex, keyAlgorithm);
const transferId = transferIdFor(receiptId);
const deploy = makeCsprTransferDeploy({
  senderPublicKeyHex: privateKey.publicKey.toHex(),
  recipientPublicKeyHex: recipientHex,
  transferAmount: amountMotes,
  paymentAmount: paymentMotes,
  transferId,
  chainName,
});

deploy.sign(privateKey);

const metadata = {
  ok: true,
  mode: dryRun ? 'dry-run' : 'broadcast',
  network: chainName,
  rpc_url: rpcUrl,
  sender_public_key: privateKey.publicKey.toHex(),
  recipient_public_key: recipientHex,
  amount_motes: amountMotes,
  payment_motes: paymentMotes,
  receipt_id: receiptId,
  transfer_id: transferId,
  explorer_hint: 'https://testnet.cspr.live/',
};

if (dryRun) {
  console.log(JSON.stringify(metadata, null, 2));
  process.exit(0);
}

const rpcClient = new RpcClient(new HttpHandler(rpcUrl));
const result = await rpcClient.putDeploy(deploy);
console.log(JSON.stringify({
  ...metadata,
  deploy_hash: result.deployHash,
  explorer_url: `https://testnet.cspr.live/deploy/${result.deployHash}`,
}, null, 2));
