/**
 * Perplexity Sonar — real-time travel intel
 *
 * Answers grounded questions using live web search:
 *   - Opening hours / entry requirements
 *   - Baggage policies
 *   - Travel advisories / safety
 *   - Local conditions ("is it crowded", "what's the weather like")
 *   - Visa requirements
 *
 * Model: sonar (fast, cheap) — falls back to empty string if key absent.
 * Edge-compatible: pure REST, no Node SDK.
 */

const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';

export interface SonarResult {
  answer: string;
  /** Source URLs cited by Perplexity */
  citations: string[];
}

/**
 * Ask Perplexity a travel-intel question.
 * Returns answer + citations, or null if key is absent or request fails.
 */
export async function askSonar(
  question: string,
  apiKey: string,
  opts: { maxTokens?: number; model?: string } = {},
): Promise<SonarResult | null> {
  if (!apiKey) return null;

  const model = opts.model ?? 'sonar';
  const maxTokens = opts.maxTokens ?? 256;

  try {
    const res = await fetch(PERPLEXITY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'system',
            content: 'You are a precise travel information assistant. Answer in 1-3 sentences, cite sources. Be factual and current.',
          },
          { role: 'user', content: question },
        ],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    };

    const answer = data.choices?.[0]?.message?.content ?? '';
    const citations = data.citations ?? [];
    return answer ? { answer, citations } : null;
  } catch {
    return null;
  }
}

/**
 * Format Sonar result for injection into Claude's tool result.
 */
export function formatSonarForClaude(result: SonarResult | null, question: string): string {
  if (!result) return `No live intel available for: ${question}`;
  const citeLine = result.citations.length > 0
    ? `\nSources: ${result.citations.slice(0, 2).join(', ')}`
    : '';
  return `${result.answer}${citeLine}`;
}
