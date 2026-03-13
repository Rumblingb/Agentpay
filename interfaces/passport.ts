// AgentPassport public schema and types
export interface AgentPassport {
  id: string;
  name: string;
  trust: number;
  grade?: string;
  reliability?: number;
  txCount?: number;
  volume?: number;
  recent?: string[];
}

export interface PassportClaim {
  issuer: string;
  signature?: string;
  claim: Record<string, any>;
}
