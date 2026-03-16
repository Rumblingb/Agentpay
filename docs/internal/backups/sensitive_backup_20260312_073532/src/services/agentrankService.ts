/**
 * AgentRank Service — real-time score management with history tracking.
 *
 * Bridges all reputation systems:
 *   - Escrow approve/release → +10 delta
 *   - Escrow dispute          → −20 delta for guilty party
 *   - Payment verification    → +5 success / −5 failure
 *   - Manual adjustment       → admin-specified delta
 *
 * Every score change is recorded in the `history` JSONB field.
 *
 * @module services/agentrankService
 */

import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { logger } from '../logger.js';

export interface AgentRankHistoryEntry {
  score: number;
  timestamp: string;
  reason: string;
}

const MAX_HISTORY_ENTRIES = 100;
const MAX_SCORE = 1000;
const MIN_SCORE = 0;

function clampScore(score: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
}

function scoreToGrade(score: number): string {
  if (score >= 950) return 'S';
  if (score >= 800) return 'A';
  if (score >= 600) return 'B';
  if (score >= 400) return 'C';
  return 'F';
}

function readHistory(value: Prisma.JsonValue | null | undefined): AgentRankHistoryEntry[] {
  if (!Array.isArray(value)) return [];

  return (value as unknown[]).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const obj = item as Record<string, unknown>;
    if (
      typeof obj.score === 'number' &&
      typeof obj.timestamp === 'string' &&
      typeof obj.reason === 'string'
    ) {
      return [
        {
          score: obj.score,
          timestamp: obj.timestamp,
          reason: obj.reason,
        },
      ];
    }

    return [];
  });
}

function writeHistory(history: AgentRankHistoryEntry[]): Prisma.InputJsonValue {
  return history as unknown as Prisma.InputJsonValue;
}

/**
 * Adjust an agent's AgentRank score by a delta, recording the change in history.
 */
export async function adjustScore(
  agentId: string,
  delta: number,
  event: string,
  details?: string,
): Promise<{
  agentId: string;
  score: number;
  grade: string;
  history: AgentRankHistoryEntry[];
} | null> {
  try {
    const existing = await prisma.agentrank_scores.findUnique({
      where: { agent_id: agentId },
    });

    const oldScore = existing?.score ?? 0;
    const newScore = clampScore(oldScore + delta);
    const newGrade = scoreToGrade(newScore);

    const historyEntry: AgentRankHistoryEntry = {
      score: newScore,
      timestamp: new Date().toISOString(),
      reason: details ? `${event}: ${details}` : event,
    };

    const existingHistory = readHistory(existing?.history);
    const updatedHistory = [...existingHistory, historyEntry].slice(-MAX_HISTORY_ENTRIES);

    let record = null;
    try {
      if (existing) {
        record = await prisma.agentrank_scores.update({
          where: { agent_id: agentId },
          data: {
            score: newScore,
            grade: newGrade,
            history: writeHistory(updatedHistory),
            updated_at: new Date(),
          },
        });
      } else {
        record = await prisma.agentrank_scores.create({
          data: {
            agent_id: agentId,
            score: newScore,
            grade: newGrade,
            history: writeHistory(updatedHistory),
            updated_at: new Date(),
          },
        });
      }
    } catch (dbErr: any) {
      logger.error('AgentRank adjustment failed', {
        agentId,
        event,
        error: dbErr?.message,
      });
      return null;
    }

    logger.info('AgentRank score adjusted', {
      agentId,
      event,
      delta,
      oldScore,
      newScore,
      newGrade,
    });

    if (!record) {
      return null;
    }
    return {
      agentId: record.agent_id,
      score: record.score,
      grade: record.grade,
      history: readHistory(record.history),
    };
  } catch (err: any) {
    logger.error('AgentRank adjustment failed', {
      agentId,
      event,
      error: err?.message,
    });
    return null;
  }
}

/**
 * Get the score history for an agent.
 */
export async function getScoreHistory(
  agentId: string,
): Promise<{
  score: number;
  grade: string;
  history: AgentRankHistoryEntry[];
} | null> {
  try {
    const record = await prisma.agentrank_scores.findUnique({
      where: { agent_id: agentId },
    });

    if (!record) return null;

    return {
      score: record.score,
      grade: record.grade,
      history: readHistory(record.history),
    };
  } catch (err: any) {
    logger.warn('AgentRank history fetch failed', {
      agentId,
      error: err?.message,
    });
    return null;
  }
}