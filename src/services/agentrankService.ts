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

import prisma from '../lib/prisma.js';
import { scoreToGrade, type AgentRankHistoryEntry } from '../reputation/agentrank-core.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY_ENTRIES = 100;
const MAX_SCORE = 1000;
const MIN_SCORE = 0;

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Adjust an agent's AgentRank score by a delta, recording the change in history.
 *
 * If no agentrank_scores record exists, one is created with the delta as the
 * initial score. The `history` JSONB array is appended with a new entry.
 *
 * Returns the updated score and grade, or null if the DB is unavailable.
 */
export async function adjustScore(
  agentId: string,
  delta: number,
  event: string,
  details?: string,
): Promise<{ score: number; grade: string } | null> {
  try {
    const existing = await prisma.agentrank_scores.findUnique({
      where: { agent_id: agentId },
    });

    const oldScore = existing?.score ?? 0;
    const newScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, oldScore + delta));
    const newGrade = scoreToGrade(newScore);

    const historyEntry: AgentRankHistoryEntry = {
      score: newScore,
      timestamp: new Date().toISOString(),
      reason: details ? `${event}: ${details}` : event,
    };

    // Parse existing history, append new entry, trim to MAX_HISTORY_ENTRIES
    const existingHistory: AgentRankHistoryEntry[] = Array.isArray(existing?.history)
      ? (existing.history as AgentRankHistoryEntry[])
      : [];
    const updatedHistory = [...existingHistory, historyEntry].slice(-MAX_HISTORY_ENTRIES);

    if (existing) {
      await prisma.agentrank_scores.update({
        where: { agent_id: agentId },
        data: {
          score: newScore,
          grade: newGrade,
          history: updatedHistory,
          updated_at: new Date(),
        },
      });
    } else {
      await prisma.agentrank_scores.create({
        data: {
          agent_id: agentId,
          score: newScore,
          grade: newGrade,
          history: updatedHistory,
          updated_at: new Date(),
        },
      });
    }

    logger.info('AgentRank score adjusted', {
      agentId,
      event,
      delta,
      oldScore,
      newScore,
      newGrade,
    });

    return { score: newScore, grade: newGrade };
  } catch (err: any) {
    // Gracefully handle missing table or DB connection issues
    const isTableMissing =
      err?.code === 'P2021' ||
      (typeof err?.message === 'string' && err.message.includes('does not exist'));
    if (isTableMissing) {
      logger.warn('AgentRank adjustment skipped — table not available', { agentId, event });
    } else {
      logger.error('AgentRank adjustment failed', { agentId, event, error: err?.message });
    }
    return null;
  }
}

/**
 * Get the score history for an agent.
 * Returns the history JSONB array from the agentrank_scores record.
 */
export async function getScoreHistory(
  agentId: string,
): Promise<{ score: number; grade: string; history: AgentRankHistoryEntry[] } | null> {
  try {
    const record = await prisma.agentrank_scores.findUnique({
      where: { agent_id: agentId },
    });

    if (!record) return null;

    const history: AgentRankHistoryEntry[] = Array.isArray(record.history)
      ? (record.history as AgentRankHistoryEntry[])
      : [];

    return {
      score: record.score,
      grade: record.grade,
      history,
    };
  } catch (err: any) {
    logger.warn('AgentRank history fetch failed', { agentId, error: err?.message });
    return null;
  }
}
