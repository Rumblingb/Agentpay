// Shared trust-related interfaces for public/private boundary
export type TrustLevel = 'verified' | 'attested' | 'self-reported' | 'unverified';

export interface TrustEventRecord {
  id: string;
  agentId: string;
  eventType: string;
  timestamp: string | number | Date;
  metadata?: Record<string, any>;
  delta?: number;
}

export interface TrustScoreResponse {
  agentId: string;
  trustScore: number; // 0-100 or 0-1000 depending on context
  updatedAt?: string | number | Date;
}
