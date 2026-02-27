import crypto from 'crypto';

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/** Generate an Ed25519 keypair for agent delegation. */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
  };
}

/** Sign data with a private key (hex-encoded DER). */
export function sign(data: string, privateKeyHex: string): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  return crypto.sign(null, Buffer.from(data), privateKey).toString('hex');
}

/** Verify a signature with a public key (hex-encoded DER). */
export function verify(data: string, signatureHex: string, publicKeyHex: string): boolean {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyHex, 'hex'),
    format: 'der',
    type: 'spki',
  });
  return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signatureHex, 'hex'));
}
