// Minimal @solana/web3.js mock for tests
const Keypair = {
  generate: () => ({ publicKey: { toString: () => 'TestWalletAddress111111111111111111111111' } }),
};
// Minimal PublicKey implementation for tests. Accepts base58-like strings
// of typical Solana address lengths and provides `toBytes()` returning a
// 32-byte Uint8Array for valid inputs; throws for invalid inputs.
const PublicKey = function (s) {
  this._s = String(s);
  // Basic Base58 charset check (excludes 0,O,I,l)
  const base58RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
  const len = this._s.length;
  if (!base58RE.test(this._s) || len < 32 || len > 44) {
    // mimic real SDK behavior by throwing on invalid input
    throw new Error('Invalid public key input');
  }
};

PublicKey.prototype.toBytes = function () {
  // Return a deterministic 32-byte array (content not important for tests)
  return new Uint8Array(32);
};

// Minimal Connection stub used by code that only constructs a Connection
// but doesn't require real RPC interaction in unit tests.
class Connection {
  constructor(_url, _opts) {
    this._url = _url;
    this._opts = _opts;
  }
  // noop methods used in tests
  async getRecentBlockhash() { return { blockhash: 'HBLOCK', lastValidBlockHeight: 0 }; }
  async getConfirmedSignaturesForAddress2() { return []; }
  async getParsedTransaction(_txHash, _opts) { return null; }
  async getBlockHeight(_commitment) { return 0; }
}

module.exports = { Keypair, PublicKey, Connection };
