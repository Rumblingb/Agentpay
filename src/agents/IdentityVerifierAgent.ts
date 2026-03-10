/**
 * IdentityVerifierAgent - Constitutional Layer Agent #1
 *
 * Verifies agent identity, ownership, environment, and provenance claims.
 * Creates the identity attestation layer for the agent economy.
 *
 * Core Functions:
 * 1. Verify agent ownership (agent X belongs to operator Y)
 * 2. Verify execution environment (runs on platform Z)
 * 3. Issue verifiable credentials
 * 4. Link cross-platform identities
 *
 * Revenue: $10-50 per verification
 * Moat: Identity graph with cross-platform links
 */

import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { sign, verify } from 'jsonwebtoken';

interface VerificationRequest {
  agentId: string;
  requestingOperatorId: string;
  claimedEnvironment: {
    platform: 'openai' | 'anthropic' | 'replit' | 'vercel' | 'local' | 'other';
    runtime: string;
    version?: string;
  };
  proofs: {
    type: 'oauth' | 'api_key' | 'signature' | 'deployment';
    value: string;
  }[];
}

interface VerificationCredential {
  credentialId: string;
  agentId: string;
  operatorId: string;
  environment: any;
  issuedAt: Date;
  expiresAt: Date;
  signature: string;
  trustLevel: 'verified' | 'attested' | 'self-reported';
  /**
   * keyMode indicates whether this credential was signed with a stable configured
   * key ("configured") or an ephemeral per-process random key ("ephemeral").
   *
   * Credentials issued in "ephemeral" mode CANNOT be verified after a server
   * restart because the signing key is lost. They should be treated as
   * session-scoped attestations only, not durable identity proofs.
   */
  keyMode: 'configured' | 'ephemeral';
  /**
   * proofVerificationMode indicates whether external proof verification
   * (signature checks, deployment URL checks) is live or stubbed.
   *
   * "beta_stub" = proof functions always return true; credentials are NOT
   * cryptographically auditable proofs. Do NOT treat "verified" trust level
   * as a hard security guarantee when this field is "beta_stub".
   */
  proofVerificationMode: 'live' | 'beta_stub';
}

interface IdentityLink {
  linkId: string;
  primaryAgentId: string;
  linkedAgentIds: string[];
  crossPlatformProof: any;
  createdAt: Date;
}

class IdentityVerifierAgent {
  private agentId = 'identity_verifier_001';
  private privateKey: string;

  /**
   * keyMode tracks whether a stable configured key is in use.
   * "ephemeral" means IDENTITY_VERIFIER_PRIVATE_KEY was not set — a random
   * key was generated for this process instance. Credentials issued in
   * ephemeral mode cannot be verified after a server restart.
   */
  readonly keyMode: 'configured' | 'ephemeral';

  // Pricing
  private VERIFICATION_FEE_BASIC = 10;
  private VERIFICATION_FEE_ADVANCED = 50;

  // Credential validity (days)
  private CREDENTIAL_VALIDITY_DAYS = 90;

  /**
   * Beta stub — tracks whether external proof verification is live.
   *
   * proofVerificationMode: "beta_stub" means verifySignatureProof and
   * verifyDeploymentProof are NOT performing real cryptographic or network
   * verification. Any credential issued with this flag should NOT be
   * treated as a cryptographically auditable identity proof.
   *
   * This must remain "beta_stub" until:
   *   - verifySignatureProof implements Ed25519/secp256k1 signature checking
   *   - verifyDeploymentProof implements deployment URL + response verification
   */
  private readonly proofVerificationMode: 'beta_stub' | 'live' = 'beta_stub';

  constructor() {
    const configuredKey = process.env.IDENTITY_VERIFIER_PRIVATE_KEY;

    if (configuredKey && configuredKey.length >= 32) {
      // HS256 uses a shared secret (hex string is fine for HMAC-SHA256)
      this.privateKey = configuredKey;
      this.keyMode = 'configured';
    } else {
      // No stable key — generate an ephemeral one for this process.
      // Credentials issued here CANNOT be verified after a server restart.
      this.privateKey = crypto.randomBytes(32).toString('hex');
      this.keyMode = 'ephemeral';

      const warning =
        '[IdentityVerifierAgent] WARNING: IDENTITY_VERIFIER_PRIVATE_KEY is not set ' +
        'or is shorter than 32 characters. An ephemeral random key has been generated. ' +
        'Credentials issued now will be unverifiable after a server restart. ' +
        'Set IDENTITY_VERIFIER_PRIVATE_KEY in production to use durable credential signing. ' +
        'Generate a key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';

      console.warn(warning);
    }
  }

  /**
   * Verify agent identity and issue credential
   */
  async verifyIdentity(request: VerificationRequest): Promise<VerificationCredential> {
    await this.chargeVerificationFee(request.requestingOperatorId, this.VERIFICATION_FEE_BASIC);

    const ownershipVerified = await this.verifyOwnership(
      request.agentId,
      request.requestingOperatorId,
      request.proofs
    );

    if (!ownershipVerified) {
      throw new Error('Ownership verification failed');
    }

    const environmentVerified = await this.verifyEnvironment(
      request.claimedEnvironment,
      request.proofs
    );

    const trustLevel = this.determineTrustLevel(
      ownershipVerified,
      environmentVerified,
      request.proofs.length
    );

    const credential = await this.issueCredential(
      request.agentId,
      request.requestingOperatorId,
      request.claimedEnvironment,
      trustLevel
    );

    await this.storeIdentityRecord(credential);

    return credential;
  }

  /**
   * Link multiple agent identities across platforms
   */
  async linkIdentities(
    primaryAgentId: string,
    linkedAgentIds: string[],
    proofs: any[],
    operatorId: string
  ): Promise<IdentityLink> {
    await this.chargeVerificationFee(operatorId, this.VERIFICATION_FEE_ADVANCED);

    const ownershipVerified = await Promise.all(
      [primaryAgentId, ...linkedAgentIds].map(id =>
        this.verifyAgentOwnership(id, operatorId)
      )
    );

    if (!ownershipVerified.every(v => v)) {
      throw new Error('Not all agents belong to the same operator');
    }

    const crossPlatformProof = await this.verifyCrossPlatformLink(
      primaryAgentId,
      linkedAgentIds,
      proofs
    );

    const link: IdentityLink = {
      linkId: this.generateLinkId(),
      primaryAgentId,
      linkedAgentIds,
      crossPlatformProof,
      createdAt: new Date()
    };

    await this.storeIdentityLink(link);

    return link;
  }

  /**
   * Verify an existing credential
   */
  async verifyCredential(credentialId: string): Promise<{
    valid: boolean;
    credential?: VerificationCredential;
    reason?: string;
  }> {
    const credential = await this.fetchCredential(credentialId);

    if (!credential) {
      return { valid: false, reason: 'Credential not found' };
    }

    if (new Date() > credential.expiresAt) {
      return { valid: false, reason: 'Credential expired' };
    }

    const signatureValid = await this.verifySignature(
      credential.signature,
      this.serializeCredential(credential)
    );

    if (!signatureValid) {
      return { valid: false, reason: 'Invalid signature' };
    }

    const revoked = await this.isCredentialRevoked(credentialId);

    if (revoked) {
      return { valid: false, reason: 'Credential revoked' };
    }

    return { valid: true, credential };
  }

  /**
   * Get agent's identity record
   */
  async getIdentityRecord(agentId: string): Promise<{
    agentId: string;
    verified: boolean;
    credentials: VerificationCredential[];
    linkedIdentities: string[];
    trustLevel: string;
    firstVerified?: Date;
  }> {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        verificationCredentials: true,
        identityLinks: true
      }
    });

    if (!agent) {
      throw new Error('Agent not found');
    }

    const activeCredentials = agent.verificationCredentials.filter(
      c => new Date() < new Date(c.expiresAt) && !c.revoked
    );

    const linkedIdentities = agent.identityLinks
      .flatMap((link: any) => link.linkedAgentIds as string[])
      .filter((id: string) => id !== agentId);

    return {
      agentId: agent.id,
      verified: activeCredentials.length > 0,
      credentials: activeCredentials as any,
      linkedIdentities,
      trustLevel: (activeCredentials[0] as any)?.trustLevel || 'unverified',
      firstVerified: activeCredentials[0]?.issuedAt
    };
  }

  // Private implementation methods

  private async verifyOwnership(
    agentId: string,
    operatorId: string,
    proofs: any[]
  ): Promise<boolean> {
    const agent = await prisma.agent.findFirst({
      where: {
        id: agentId,
        operatorId: operatorId
      }
    });

    if (!agent) return false;

    for (const proof of proofs) {
      if (proof.type === 'signature') {
        const valid = await this._betaStub_verifySignatureProof(agentId, proof.value);
        if (!valid) return false;
      }
    }

    return true;
  }

  private async verifyEnvironment(environment: any, proofs: any[]): Promise<boolean> {
    for (const proof of proofs) {
      if (proof.type === 'deployment') {
        const valid = await this._betaStub_verifyDeploymentProof(environment, proof.value);
        if (!valid) return false;
      }
    }
    return true;
  }

  private determineTrustLevel(
    ownershipVerified: boolean,
    environmentVerified: boolean,
    proofCount: number
  ): 'verified' | 'attested' | 'self-reported' {
    if (ownershipVerified && environmentVerified && proofCount >= 2) {
      // "verified" requires:
      //   1. A stable configured signing key (not ephemeral)
      //   2. Live proof verification (not beta stubs)
      // Without both, the highest achievable level is "attested".
      if (this.keyMode === 'ephemeral' || this.proofVerificationMode === 'beta_stub') {
        return 'attested';
      }
      return 'verified';
    }
    if (ownershipVerified && proofCount >= 1) {
      return 'attested';
    }
    return 'self-reported';
  }

  private async issueCredential(
    agentId: string,
    operatorId: string,
    environment: any,
    trustLevel: 'verified' | 'attested' | 'self-reported'
  ): Promise<VerificationCredential> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.CREDENTIAL_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

    const credential: VerificationCredential = {
      credentialId: this.generateCredentialId(),
      agentId,
      operatorId,
      environment,
      issuedAt: now,
      expiresAt,
      signature: '',
      trustLevel,
      keyMode: this.keyMode,
      proofVerificationMode: this.proofVerificationMode,
    };

    credential.signature = await this.signCredential(credential);

    return credential;
  }

  private async signCredential(credential: VerificationCredential): Promise<string> {
    const payload = this.serializeCredential(credential);
    // HS256 works with any string/Buffer secret (RS256 requires PEM RSA key)
    return sign(payload, this.privateKey, { algorithm: 'HS256' });
  }

  private async verifySignature(signature: string, _payload: string): Promise<boolean> {
    try {
      verify(signature, this.privateKey, { algorithms: ['HS256'] });
      return true;
    } catch {
      return false;
    }
  }

  private serializeCredential(credential: VerificationCredential): string {
    return JSON.stringify({
      credentialId: credential.credentialId,
      agentId: credential.agentId,
      operatorId: credential.operatorId,
      environment: credential.environment,
      issuedAt: credential.issuedAt instanceof Date
        ? credential.issuedAt.toISOString()
        : credential.issuedAt,
      expiresAt: credential.expiresAt instanceof Date
        ? credential.expiresAt.toISOString()
        : credential.expiresAt,
      trustLevel: credential.trustLevel
    });
  }

  private async storeIdentityRecord(credential: VerificationCredential): Promise<void> {
    await prisma.verificationCredential.create({
      data: {
        id: credential.credentialId,
        agentId: credential.agentId,
        operatorId: credential.operatorId,
        environment: credential.environment,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
        signature: credential.signature,
        trustLevel: credential.trustLevel,
        revoked: false
      }
    });
  }

  private async storeIdentityLink(link: IdentityLink): Promise<void> {
    await prisma.identityLink.create({
      data: {
        id: link.linkId,
        primaryAgentId: link.primaryAgentId,
        linkedAgentIds: link.linkedAgentIds,
        crossPlatformProof: link.crossPlatformProof,
        createdAt: link.createdAt
      }
    });
  }

  private async fetchCredential(credentialId: string): Promise<VerificationCredential | null> {
    const cred = await prisma.verificationCredential.findUnique({
      where: { id: credentialId }
    });

    if (!cred) return null;

    return {
      credentialId: cred.id,
      agentId: cred.agentId,
      operatorId: cred.operatorId,
      environment: cred.environment as any,
      issuedAt: cred.issuedAt,
      expiresAt: cred.expiresAt,
      signature: cred.signature,
      trustLevel: cred.trustLevel as any,
      // Credentials fetched from the DB do not know which key mode was active
      // when they were issued. Treat stored credentials as 'configured' — if the
      // signature check in verifyCredential() passes, the key must still be valid.
      keyMode: 'configured',
      // Conservatively mark as beta_stub since we cannot tell how they were issued.
      proofVerificationMode: 'beta_stub',
    };
  }

  private async isCredentialRevoked(credentialId: string): Promise<boolean> {
    const cred = await prisma.verificationCredential.findUnique({
      where: { id: credentialId },
      select: { revoked: true }
    });
    return cred?.revoked || false;
  }

  private async verifyAgentOwnership(agentId: string, operatorId: string): Promise<boolean> {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, operatorId }
    });
    return !!agent;
  }

  private async verifyCrossPlatformLink(
    _primaryId: string,
    _linkedIds: string[],
    proofs: any[]
  ): Promise<any> {
    // BETA STUB: cross-platform proof is recorded but not independently verified.
    return { verified: true, proofs, verificationMode: 'beta_stub' };
  }

  /**
   * BETA STUB — always returns true.
   *
   * Production implementation must verify the provided signature against
   * the agent's registered public key using Ed25519 or secp256k1.
   *
   * This stub means "signature" proofs do NOT add real cryptographic weight
   * to a credential. The trust level is capped at "attested" because of this.
   */
  private async _betaStub_verifySignatureProof(_agentId: string, _signature: string): Promise<boolean> {
    console.warn(
      '[IdentityVerifierAgent] BETA: verifySignatureProof is a stub — ' +
      'signature not cryptographically verified. Proof accepted unconditionally.'
    );
    return true;
  }

  /**
   * BETA STUB — always returns true.
   *
   * Production implementation must ping the claimed deployment URL, parse the
   * response, and verify a signed token that proves the deployment belongs to
   * the claimed operator.
   *
   * This stub means "deployment" proofs do NOT add real environment verification.
   * The trust level is capped at "attested" because of this.
   */
  private async _betaStub_verifyDeploymentProof(_environment: any, _proof: string): Promise<boolean> {
    console.warn(
      '[IdentityVerifierAgent] BETA: verifyDeploymentProof is a stub — ' +
      'deployment not independently verified. Proof accepted unconditionally.'
    );
    return true;
  }

  private async chargeVerificationFee(operatorId: string, fee: number): Promise<void> {
    await prisma.agentFeeTransaction.create({
      data: {
        fromAgent: operatorId,
        toAgent: this.agentId,
        amount: fee,
        status: 'completed',
        description: 'Identity verification fee',
        metadata: { service: 'IdentityVerifier' }
      }
    });
  }

  private generateCredentialId(): string {
    return `cred_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private generateLinkId(): string {
    return `link_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }
}

export const identityVerifierAgent = new IdentityVerifierAgent();

export async function handleIdentityVerification(req: any, res: any) {
  const { action, ...params } = req.body;

  // The authenticated merchant ID is the billing operator.
  // Always use req.merchant.id — never trust a caller-supplied operatorId for billing.
  const merchantId: string = req.merchant?.id;

  try {
    switch (action) {
      case 'verify': {
        const credential = await identityVerifierAgent.verifyIdentity({
          ...params,
          requestingOperatorId: merchantId,
        });
        return res.json({ success: true, credential });
      }
      case 'link': {
        const link = await identityVerifierAgent.linkIdentities(
          params.primaryAgentId,
          params.linkedAgentIds,
          params.proofs,
          merchantId,   // always use authenticated merchant, not caller-supplied operatorId
        );
        return res.json({ success: true, link });
      }
      case 'verify_credential': {
        const verification = await identityVerifierAgent.verifyCredential(params.credentialId);
        return res.json(verification);
      }
      case 'get_identity': {
        const identity = await identityVerifierAgent.getIdentityRecord(params.agentId);
        return res.json(identity);
      }
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Identity verification error:', error);
    return res.status(500).json({ error: error.message });
  }
}
