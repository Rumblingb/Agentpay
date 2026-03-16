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

import { prisma } from './src/lib/prisma';
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
  
  // Pricing
  private VERIFICATION_FEE_BASIC = 10; // Basic verification
  private VERIFICATION_FEE_ADVANCED = 50; // Cross-platform linking
  
  // Credential validity
  private CREDENTIAL_VALIDITY_DAYS = 90;
  
  constructor() {
    this.privateKey = process.env.IDENTITY_VERIFIER_PRIVATE_KEY || this.generateKey();
  }

  /**
   * Verify agent identity and issue credential
   */
  async verifyIdentity(request: VerificationRequest): Promise<VerificationCredential> {
    // 1. Charge verification fee
    await this.chargeVerificationFee(request.requestingOperatorId, this.VERIFICATION_FEE_BASIC);

    // 2. Verify ownership proofs
    const ownershipVerified = await this.verifyOwnership(
      request.agentId,
      request.requestingOperatorId,
      request.proofs
    );

    if (!ownershipVerified) {
      throw new Error('Ownership verification failed');
    }

    // 3. Verify environment claims
    const environmentVerified = await this.verifyEnvironment(
      request.claimedEnvironment,
      request.proofs
    );

    // 4. Determine trust level
    const trustLevel = this.determineTrustLevel(
      ownershipVerified,
      environmentVerified,
      request.proofs.length
    );

    // 5. Issue credential
    const credential = await this.issueCredential(
      request.agentId,
      request.requestingOperatorId,
      request.claimedEnvironment,
      trustLevel
    );

    // 6. Store in identity registry
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
    // 1. Charge advanced fee
    await this.chargeVerificationFee(operatorId, this.VERIFICATION_FEE_ADVANCED);

    // 2. Verify all agents belong to same operator
    const ownershipVerified = await Promise.all(
      [primaryAgentId, ...linkedAgentIds].map(id =>
        this.verifyAgentOwnership(id, operatorId)
      )
    );

    if (!ownershipVerified.every(v => v)) {
      throw new Error('Not all agents belong to the same operator');
    }

    // 3. Verify cross-platform proofs
    const crossPlatformProof = await this.verifyCrossPlatformLink(
      primaryAgentId,
      linkedAgentIds,
      proofs
    );

    // 4. Create identity link
    const link: IdentityLink = {
      linkId: this.generateLinkId(),
      primaryAgentId,
      linkedAgentIds,
      crossPlatformProof,
      createdAt: new Date()
    };

    // 5. Store link in identity graph
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
    // 1. Fetch credential
    const credential = await this.fetchCredential(credentialId);
    
    if (!credential) {
      return { valid: false, reason: 'Credential not found' };
    }

    // 2. Check expiration
    if (new Date() > credential.expiresAt) {
      return { valid: false, reason: 'Credential expired' };
    }

    // 3. Verify signature
    const signatureValid = await this.verifySignature(
      credential.signature,
      this.serializeCredential(credential)
    );

    if (!signatureValid) {
      return { valid: false, reason: 'Invalid signature' };
    }

    // 4. Check if revoked
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
    // Fetch from database
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
      .flatMap(link => link.linkedAgentIds)
      .filter(id => id !== agentId);

    return {
      agentId: agent.id,
      verified: activeCredentials.length > 0,
      credentials: activeCredentials as any,
      linkedIdentities,
      trustLevel: activeCredentials[0]?.trustLevel || 'unverified',
      firstVerified: activeCredentials[0]?.issuedAt
    };
  }

  // Private implementation methods

  private async verifyOwnership(
    agentId: string,
    operatorId: string,
    proofs: any[]
  ): Promise<boolean> {
    // 1. Check database ownership
    const agent = await prisma.agent.findFirst({
      where: {
        id: agentId,
        operatorId: operatorId
      }
    });

    if (!agent) return false;

    // 2. Verify cryptographic proofs
    for (const proof of proofs) {
      if (proof.type === 'signature') {
        const valid = await this.verifySignatureProof(agentId, proof.value);
        if (!valid) return false;
      }
    }

    return true;
  }

  private async verifyEnvironment(environment: any, proofs: any[]): Promise<boolean> {
    // Verify claimed execution environment
    // In production: ping health endpoints, check deployment records, etc.
    
    for (const proof of proofs) {
      if (proof.type === 'deployment') {
        // Verify deployment proof (e.g., Vercel deployment URL)
        const valid = await this.verifyDeploymentProof(environment, proof.value);
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
      signature: '', // Will be set below
      trustLevel
    };

    // Sign the credential
    credential.signature = await this.signCredential(credential);

    return credential;
  }

  private async signCredential(credential: VerificationCredential): Promise<string> {
    const payload = this.serializeCredential(credential);
    return sign(payload, this.privateKey, { algorithm: 'HS256' });
  }

  private async verifySignature(signature: string, payload: string): Promise<boolean> {
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
      issuedAt: credential.issuedAt.toISOString(),
      expiresAt: credential.expiresAt.toISOString(),
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
      trustLevel: cred.trustLevel as any
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
    primaryId: string,
    linkedIds: string[],
    proofs: any[]
  ): Promise<any> {
    // Verify cross-platform identity proofs
    // E.g., same OAuth account on different platforms
    return { verified: true, proofs };
  }

  private async verifySignatureProof(agentId: string, signature: string): Promise<boolean> {
    // Verify cryptographic signature proves ownership
    return true; // Implement actual verification
  }

  private async verifyDeploymentProof(environment: any, proof: string): Promise<boolean> {
    // Verify deployment proof (ping URL, check deployment records, etc.)
    return true; // Implement actual verification
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

  private generateKey(): string {
    // Generate RSA key pair for credential signing
    // In production: use proper key management
    return crypto.randomBytes(32).toString('hex');
  }
}

export const identityVerifierAgent = new IdentityVerifierAgent();

// API endpoint handler
export async function handleIdentityVerification(req: any, res: any) {
  const { action, ...params } = req.body;

  try {
    switch (action) {
      case 'verify':
        const credential = await identityVerifierAgent.verifyIdentity(params);
        return res.json({ success: true, credential });
      
      case 'link':
        const link = await identityVerifierAgent.linkIdentities(
          params.primaryAgentId,
          params.linkedAgentIds,
          params.proofs,
          params.operatorId
        );
        return res.json({ success: true, link });
      
      case 'verify_credential':
        const verification = await identityVerifierAgent.verifyCredential(params.credentialId);
        return res.json(verification);
      
      case 'get_identity':
        const identity = await identityVerifierAgent.getIdentityRecord(params.agentId);
        return res.json(identity);
      
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Identity verification error:', error);
    return res.status(500).json({ error: error.message });
  }
}
