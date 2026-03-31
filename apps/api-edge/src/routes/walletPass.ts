/**
 * walletPass.ts — Apple Wallet .pkpass generation
 *
 * GET /api/wallet/pass/:intentId
 *
 * Returns a signed .pkpass file for a confirmed booking.
 * The pass opens in Apple Wallet and shows boarding details on the lock screen.
 *
 * Requires these secrets (set via wrangler secret put):
 *   APPLE_PASS_TEAM_ID        — your 10-char Apple Developer team ID
 *   APPLE_PASS_TYPE_ID        — Pass Type ID, e.g. "pass.so.agentpay.ace"
 *   APPLE_PASS_CERT_PEM       — Pass Type Certificate (PEM, without bag attributes)
 *   APPLE_PASS_KEY_PEM        — Matching private key (PEM, PKCS8)
 *   APPLE_PASS_WWDR_PEM       — Apple WWDR G4 intermediate cert (PEM)
 *
 * The pkpass format is a ZIP file (store method, no compression) containing:
 *   pass.json, manifest.json, signature, icon.png, icon@2x.png
 *
 * Apple Wallet verifies the SHA1 manifest against the detached PKCS7 signature.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { createDb } from '../lib/db';

export const walletPassRouter = new Hono<{ Bindings: Env }>();

// ── Minimal 1×1 transparent PNG (base64) ─────────────────────────────────────
// Smallest valid PNG — used as icon placeholder until real assets are provided.
const ICON_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── ZIP builder (store method — no compression) ────────────────────────────
// pkpass files are ZIPs with store (no compression) for each file.
// Implements just enough of the ZIP spec to produce a valid archive.

function writeUint16LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}

function writeUint32LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
}

async function crc32(data: Uint8Array): Promise<number> {
  // CRC32 table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ (data[i] ?? 0)) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

async function buildZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const localHeaders: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc       = await crc32(entry.data);
    const size      = entry.data.length;

    // Local file header signature: PK\x03\x04
    const local = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]), // signature
      writeUint16LE(20),                          // version needed
      writeUint16LE(0),                           // general flags
      writeUint16LE(0),                           // compression = store
      writeUint16LE(0),                           // mod time
      writeUint16LE(0),                           // mod date
      writeUint32LE(crc),
      writeUint32LE(size),
      writeUint32LE(size),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),                           // extra length
      nameBytes,
      entry.data,
    ]);

    offsets.push(offset);
    localHeaders.push(local);
    offset += local.length;

    // Central directory entry signature: PK\x01\x02
    const central = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]), // signature
      writeUint16LE(20),                          // version made by
      writeUint16LE(20),                          // version needed
      writeUint16LE(0),
      writeUint16LE(0),                           // store
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint32LE(crc),
      writeUint32LE(size),
      writeUint32LE(size),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),                           // extra
      writeUint16LE(0),                           // comment
      writeUint16LE(0),                           // disk start
      writeUint16LE(0),                           // internal attr
      writeUint32LE(0),                           // external attr
      writeUint32LE(offsets[offsets.length - 1]!),
      nameBytes,
    ]);

    centralEntries.push(central);
  }

  const centralSize = centralEntries.reduce((s, e) => s + e.length, 0);

  // End of central directory: PK\x05\x06
  const eocd = concatBytes([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    writeUint16LE(0),                             // disk number
    writeUint16LE(0),                             // disk with CD
    writeUint16LE(entries.length),
    writeUint16LE(entries.length),
    writeUint32LE(centralSize),
    writeUint32LE(offset),
    writeUint16LE(0),                             // comment length
  ]);

  return concatBytes([...localHeaders, ...centralEntries, eocd]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let pos     = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// ── SHA1 hash helper ────────────────────────────────────────────────────────

async function sha1Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── PKCS7 signature (detached CMS SignedData) ───────────────────────────────
// Apple Wallet requires SHA1withRSA signed with the Pass Type certificate.
// The signature is a DER-encoded PKCS7 ContentInfo with detached data.

function derLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  if (len < 0x100) return new Uint8Array([0x81, len]);
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derSeq(content: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([0x30]), derLength(content.length), content]);
}

function derSet(content: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([0x31]), derLength(content.length), content]);
}

function derOid(bytes: number[]): Uint8Array {
  return concatBytes([new Uint8Array([0x06]), derLength(bytes.length), new Uint8Array(bytes)]);
}

function derInt(bytes: number[]): Uint8Array {
  return concatBytes([new Uint8Array([0x02]), derLength(bytes.length), new Uint8Array(bytes)]);
}

function derOctetStr(data: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([0x04]), derLength(data.length), data]);
}

function derContextTag(tag: number, content: Uint8Array, constructed = false): Uint8Array {
  const type = 0xa0 | tag | (constructed ? 0x20 : 0);
  return concatBytes([new Uint8Array([type]), derLength(content.length), content]);
}

// OIDs
const OID_DATA           = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]; // 1.2.840.113549.1.7.1
const OID_SIGNED_DATA    = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]; // 1.2.840.113549.1.7.2
const OID_SHA1           = [0x2b, 0x0e, 0x03, 0x02, 0x1a];                          // 1.3.14.3.2.26
const OID_SHA1_WITH_RSA  = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x05]; // 1.2.840.113549.1.1.5
const OID_CONTENT_TYPE   = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x03]; // 1.2.840.113549.1.9.3
const OID_MESSAGE_DIGEST = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]; // 1.2.840.113549.1.9.4

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN .*?-----/g, '')
    .replace(/-----END .*?-----/g, '')
    .replace(/\s+/g, '');
  return b64ToBytes(b64);
}

// ── Minimal DER TLV parser ───────────────────────────────────────────────────
// Used to extract issuer DN and serialNumber from the pass certificate so that
// the CMS IssuerAndSerialNumber in SignerInfo exactly matches the certificate.

function parseTlv(data: Uint8Array, offset: number): { tag: number; valueStart: number; valueEnd: number; nextOffset: number } {
  const tag = data[offset]!;
  let pos = offset + 1;
  let len = data[pos]!;
  pos++;
  if (len & 0x80) {
    const numBytes = len & 0x7f;
    len = 0;
    for (let i = 0; i < numBytes; i++) { len = (len << 8) | data[pos]!; pos++; }
  }
  return { tag, valueStart: pos, valueEnd: pos + len, nextOffset: pos + len };
}

/**
 * Extract the raw DER bytes of issuer (Name SEQUENCE) and serialNumber (INTEGER)
 * from an X.509 certificate DER buffer.
 *
 * TBSCertificate layout:
 *   SEQUENCE {
 *     [0] version OPTIONAL
 *     INTEGER serialNumber
 *     SEQUENCE signatureAlgorithm
 *     SEQUENCE issuer
 *     ...
 *   }
 */
function extractIssuerAndSerial(certDer: Uint8Array): { issuerDer: Uint8Array; serialDer: Uint8Array } {
  // Outer Certificate SEQUENCE
  const cert = parseTlv(certDer, 0);
  // TBSCertificate SEQUENCE
  const tbs = parseTlv(certDer, cert.valueStart);
  let off = tbs.valueStart;

  // Optional version [0] EXPLICIT
  if (certDer[off] === 0xa0) {
    off = parseTlv(certDer, off).nextOffset;
  }

  // serialNumber INTEGER — keep raw TLV bytes (tag + length + value)
  const serialTlv = parseTlv(certDer, off);
  const serialDer = certDer.slice(off, serialTlv.nextOffset);
  off = serialTlv.nextOffset;

  // signatureAlgorithm SEQUENCE — skip
  off = parseTlv(certDer, off).nextOffset;

  // issuer Name SEQUENCE — keep raw TLV bytes
  const issuerTlv = parseTlv(certDer, off);
  const issuerDer = certDer.slice(off, issuerTlv.nextOffset);

  return { issuerDer, serialDer };
}

async function signManifest(
  manifestBytes: Uint8Array,
  certPem: string,
  keyPem: string,
  wwdrPem: string,
): Promise<Uint8Array> {
  // Import private key (PKCS8 DER)
  const keyDer = pemToDer(keyPem);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  // Compute SHA1 digest of manifest
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', manifestBytes));

  // Build SignerInfo authenticated attributes (content type + message digest)
  const authAttrs = derSet(concatBytes([
    derSeq(concatBytes([derOid(OID_CONTENT_TYPE), derSet(derOid(OID_DATA))])),
    derSeq(concatBytes([derOid(OID_MESSAGE_DIGEST), derSet(derOctetStr(digest))])),
  ]));

  // The data to sign is authAttrs with SET tag replaced by SEQUENCE (0x31 → 0x30)
  const toSign = new Uint8Array(authAttrs);
  toSign[0] = 0x30;

  const sigBytes = new Uint8Array(await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    toSign,
  ));

  // Extract issuer DN and serialNumber from cert DER so SignerInfo matches exactly.
  const certDer  = pemToDer(certPem);
  const wwdrDer  = pemToDer(wwdrPem);
  const { issuerDer, serialDer } = extractIssuerAndSerial(certDer);

  // Build SignerInfo
  const signerInfo = derSeq(concatBytes([
    derInt([0x01]),                                                    // version
    derSeq(concatBytes([issuerDer, serialDer])),                       // issuerAndSerialNumber
    derSeq(concatBytes([derOid(OID_SHA1)])),                           // digestAlgorithm
    derContextTag(0, authAttrs.slice(2)),                              // authenticatedAttrs [0]
    derSeq(concatBytes([derOid(OID_SHA1_WITH_RSA), new Uint8Array([0x05, 0x00])])), // signatureAlgorithm
    derOctetStr(sigBytes),                                             // signature
  ]));

  // Build SignedData
  const signedData = derSeq(concatBytes([
    derInt([0x01]),                                                    // version
    derSet(derSeq(derOid(OID_SHA1))),                                  // digestAlgorithms
    derSeq(derOid(OID_DATA)),                                          // encapContentInfo (detached)
    derContextTag(0, concatBytes([                                     // certificates [0]
      concatBytes([new Uint8Array([0x30]), derLength(certDer.length), certDer]),
      concatBytes([new Uint8Array([0x30]), derLength(wwdrDer.length), wwdrDer]),
    ]), true),
    derSet(signerInfo),                                                // signerInfos
  ]));

  // Wrap in ContentInfo
  return derSeq(concatBytes([
    derOid(OID_SIGNED_DATA),
    derContextTag(0, signedData, true),
  ]));
}

// ── pass.json builder ───────────────────────────────────────────────────────

function buildPassJson(params: {
  teamId: string;
  passTypeId: string;
  serialNumber: string;
  description: string;
  origin: string;
  destination: string;
  departureTime: string | null;
  platform: string | null;
  bookingRef: string | null;
  operator: string | null;
  fiatAmount: number | null;
  currencySymbol: string | null;
  webServiceUrl: string;
  authToken: string;
}): string {
  const platformStr = params.platform ? `Platform ${params.platform}` : 'Platform TBC';
  const fareStr = params.fiatAmount != null && params.currencySymbol
    ? `${params.currencySymbol}${params.fiatAmount.toFixed(2)}`
    : '';

  return JSON.stringify({
    formatVersion: 1,
    passTypeIdentifier: params.passTypeId,
    serialNumber:       params.serialNumber,
    teamIdentifier:     params.teamId,
    description:        params.description,
    logoText:           'Ace',
    foregroundColor:    'rgb(220, 236, 255)',
    backgroundColor:    'rgb(8, 8, 8)',
    labelColor:         'rgb(127, 138, 152)',

    boardingPass: {
      transitType: 'PKTransitTypeTrain',
      headerFields: [
        { key: 'platform', label: 'Platform', value: platformStr },
      ],
      primaryFields: [
        { key: 'origin',      label: 'From', value: params.origin },
        { key: 'destination', label: 'To',   value: params.destination },
      ],
      secondaryFields: [
        ...(params.departureTime
          ? [{ key: 'departs', label: 'Departs', value: params.departureTime }]
          : []),
        ...(params.operator
          ? [{ key: 'operator', label: 'Operator', value: params.operator }]
          : []),
      ],
      auxiliaryFields: [
        ...(params.bookingRef
          ? [{ key: 'ref', label: 'Reference', value: params.bookingRef }]
          : []),
        ...(fareStr
          ? [{ key: 'fare', label: 'Fare', value: fareStr }]
          : []),
      ],
      backFields: [
        { key: 'powered_by', label: 'Powered by', value: 'Ace · agentpay.so' },
        { key: 'support',    label: 'Support',    value: 'support@agentpay.so' },
      ],
    },

    barcode: params.bookingRef
      ? {
          message:         params.bookingRef,
          format:          'PKBarcodeFormatQR',
          messageEncoding: 'iso-8859-1',
          altText:         params.bookingRef,
        }
      : undefined,

    webServiceURL:    params.webServiceUrl,
    authenticationToken: params.authToken,
  });
}

// ── Route ────────────────────────────────────────────────────────────────────

walletPassRouter.get('/:intentId', async (c) => {
  const { intentId } = c.req.param();
  if (!intentId) return c.json({ error: 'intentId required' }, 400);

  // Auth gate — require the same x-bro-key used by the mobile app
  const broKey = c.req.header('x-bro-key') ?? c.req.header('X-Bro-Key');
  if (!broKey || broKey !== c.env.BRO_CLIENT_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  // Check cert secrets are present — if not, fail fast with a clear message
  const teamId    = c.env.APPLE_PASS_TEAM_ID;
  const passTypeId = c.env.APPLE_PASS_TYPE_ID;
  const certPem   = c.env.APPLE_PASS_CERT_PEM;
  const keyPem    = c.env.APPLE_PASS_KEY_PEM;
  const wwdrPem   = c.env.APPLE_PASS_WWDR_PEM;

  if (!teamId || !passTypeId || !certPem || !keyPem || !wwdrPem) {
    return c.json({
      error:    'Apple Wallet not configured',
      required: ['APPLE_PASS_TEAM_ID', 'APPLE_PASS_TYPE_ID', 'APPLE_PASS_CERT_PEM', 'APPLE_PASS_KEY_PEM', 'APPLE_PASS_WWDR_PEM'],
      docs:     'https://developer.apple.com/documentation/walletpasses',
    }, 503);
  }

  if (!c.env.HYPERDRIVE?.connectionString) return c.json({ error: 'db unavailable' }, 503);
  const { default: postgres } = await import('postgres');
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 1 });

  try {
    const rows = await sql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM payment_intents WHERE id = ${intentId} LIMIT 1
    `;
    if (!rows[0]) return c.json({ error: 'not found' }, 404);

    const meta  = rows[0].metadata as any;

    // Only issue a pass for completed bookings — pendingFulfilment must be false
    // (set by concierge after Duffel/ops confirmation) or completionProof present.
    const isComplete = meta.pendingFulfilment === false || !!meta.completionProof;
    if (!isComplete) {
      return c.json({ error: 'booking not yet issued' }, 409);
    }

    const proof = meta.completionProof ?? {};

    const origin        = proof.fromStation  ?? meta.fromStation   ?? 'Origin';
    const destination   = proof.toStation    ?? meta.toStation     ?? 'Destination';
    const departureTime = proof.departureTime ?? meta.departureTime ?? null;
    const platform      = proof.platform     ?? meta.platform      ?? null;
    const bookingRef    = proof.bookingRef   ?? meta.bookingRef    ?? null;
    const operator      = proof.operator     ?? meta.operator      ?? null;
    const fiatAmount    = typeof meta.fiatAmount === 'number' ? meta.fiatAmount : null;
    const currencySymbol = meta.currencySymbol ?? '£';

    const passDesc = `${origin} → ${destination}`;
    const apiBase  = c.env.API_BASE_URL ?? 'https://api.agentpay.so';

    // authToken used by Apple Wallet to call back for updates (webServiceURL)
    const authToken = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${intentId}:${c.env.AGENTPAY_SIGNING_SECRET}`))
      .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''))
      .then(hex => hex.slice(0, 32));

    const passJson     = buildPassJson({
      teamId,
      passTypeId,
      serialNumber:  intentId,
      description:   passDesc,
      origin, destination, departureTime, platform, bookingRef, operator,
      fiatAmount, currencySymbol,
      webServiceUrl: `${apiBase}/api/wallet`,
      authToken,
    });

    const iconBytes = b64ToBytes(ICON_1X1_B64);
    const passBytes = new TextEncoder().encode(passJson);

    // Build manifest (SHA1 hashes of all files)
    const manifest = JSON.stringify({
      'pass.json':   await sha1Hex(passBytes),
      'icon.png':    await sha1Hex(iconBytes),
      'icon@2x.png': await sha1Hex(iconBytes),
    });
    const manifestBytes = new TextEncoder().encode(manifest);

    // Sign manifest
    const signature = await signManifest(manifestBytes, certPem, keyPem, wwdrPem);

    // Bundle as ZIP (store method — no compression)
    const pkpass = await buildZip([
      { name: 'pass.json',    data: passBytes    },
      { name: 'manifest.json', data: manifestBytes },
      { name: 'signature',    data: signature    },
      { name: 'icon.png',     data: iconBytes    },
      { name: 'icon@2x.png',  data: iconBytes    },
    ]);

    return new Response(pkpass, {
      headers: {
        'Content-Type':        'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="ace-${bookingRef ?? intentId}.pkpass"`,
        'Cache-Control':       'no-store',
      },
    });
  } finally {
    await sql.end();
  }
});
