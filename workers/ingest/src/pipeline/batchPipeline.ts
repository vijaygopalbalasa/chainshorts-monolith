/**
 * Batch Pipeline — Process 10 articles in 1 LLM call
 *
 * This combines relevance filtering + summarization into a single API call,
 * reducing cost by 90% compared to per-article processing.
 *
 * Cost analysis:
 * - Old: 4 LLM calls per article × 300 articles = 1,200 calls/cycle
 * - New: 1 LLM call per 10 articles × 300 articles = 30 calls/cycle
 */

import { callAgentLLM, countWords, type AgentConfig } from "@chainshorts/shared";

export interface BatchArticle {
  id: string;
  headline: string;
  body?: string;
  category: string;
  sourceId: string;
  sourceName: string;
  canonicalUrl: string;
  imageUrl?: string;
  publishedAt: string;
  clusterId: string;
  isTrustedSource: boolean;
}

export interface BatchResult {
  id: string;
  relevant: boolean;
  relevanceReason?: string;
  summary60?: string;
  wordCount?: number;
}

export interface BatchProcessResult {
  results: BatchResult[];
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  success: boolean;
  error?: string;
}

const BATCH_SYSTEM_PROMPT = `You are a Web3 news processor. For each article, output JSON with index number, relevance, and summary.

Output format - JSON array:
[{"index":0,"relevant":true,"summary60":"Your 50-70 word summary here..."},{"index":1,"relevant":false,"relevanceReason":"reason"}]

CRITICAL RULES:
1. Use article index number (0,1,2...) NOT the headline
2. relevant=true if crypto/blockchain/Web3/DeFi/Solana news
3. summary60 MUST be EXACTLY 50-70 words. Count carefully! Under 50 words = INVALID.
4. Write detailed, informative summaries. Include key facts, numbers, and context.
5. If not relevant: set relevant=false and add relevanceReason

IMPORTANT: Each summary MUST have at least 50 words. Short summaries will be rejected.`;

function buildBatchPrompt(articles: BatchArticle[]): string {
  // Use simple index (0,1,2...) instead of UUID to avoid LLM ID corruption
  const items = articles.map((a, i) => {
    const bodyPreview = (a.body ?? "").slice(0, 600).replace(/\n+/g, " ");
    return `<article index="${i}">
<headline>${a.headline.slice(0, 200)}</headline>
<body>${bodyPreview}</body>
</article>`;
  }).join("\n\n");

  return `Process these ${articles.length} Web3 news articles.

For each article, return JSON with: index (number 0-${articles.length - 1}), relevant (boolean), and either summary60 (50-70 words) if relevant, or relevanceReason if not relevant.

${items}`;
}

function parseJsonResponse(content: string): unknown[] {
  // Try to extract JSON array from response
  let cleaned = content.trim();

  // Handle markdown code blocks
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  cleaned = cleaned.trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    // Handle case where response is wrapped in object
    if (parsed.results && Array.isArray(parsed.results)) return parsed.results;
    if (parsed.articles && Array.isArray(parsed.articles)) return parsed.articles;
  } catch {
    // Try to find array in content
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // Fall through
      }
    }
  }

  return [];
}

/**
 * Process a batch of articles with a single LLM call.
 * Combines relevance filtering and summarization.
 *
 * @param articles - Array of 1-10 articles to process
 * @param config - LLM configuration (model, API key, etc.)
 * @returns Array of results with relevance and summaries
 */
export async function processBatch(
  articles: BatchArticle[],
  config: AgentConfig
): Promise<BatchProcessResult> {
  if (articles.length === 0) return { results: [], latencyMs: 0, success: true };

  // Cap batch size at 10 for optimal prompt size
  const batch = articles.slice(0, 10);
  const startTime = Date.now();

  // eslint-disable-next-line no-console
  console.log(`[batch] Processing ${batch.length} articles in 1 LLM call`);

  try {
    const result = await callAgentLLM(
      { ...config, responseFormat: "json", timeoutMs: 60_000 },
      buildBatchPrompt(batch),
      BATCH_SYSTEM_PROMPT,
      3000 // ~300 tokens per article for summaries
    );

    const parsed = parseJsonResponse(result.content);
    const latencyMs = Date.now() - startTime;

    // eslint-disable-next-line no-console
    console.log(`[batch] LLM response: ${parsed.length} results in ${latencyMs}ms`);

    // Map results back to articles using index
    const resultByIndex = new Map<number, BatchResult>();
    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      // Support both "index" and "id" fields (LLM might use either)
      const index = obj.index !== undefined ? Number(obj.index) :
                    obj.id !== undefined ? Number(obj.id) : -1;

      if (index < 0 || index >= batch.length) continue;

      const article = batch[index];
      if (!article) continue;

      const summary = obj.summary60 ? String(obj.summary60).trim() : undefined;
      const wordCount = summary ? countWords(summary) : undefined;
      const isRelevant = obj.relevant === true || obj.relevant === "true";

      resultByIndex.set(index, {
        id: article.id, // Use original article ID
        relevant: isRelevant,
        relevanceReason: obj.relevanceReason ? String(obj.relevanceReason) : undefined,
        summary60: summary,
        wordCount
      });

      // Debug log for each result
      // eslint-disable-next-line no-console
      console.log(`[batch] Article ${index}: relevant=${isRelevant}, words=${wordCount ?? 0}, reason=${obj.relevanceReason ?? "none"}`);
      if (isRelevant && summary) {
        // eslint-disable-next-line no-console
        console.log(`[batch] Summary preview: "${summary.slice(0, 80)}..."`);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[batch] Matched ${resultByIndex.size}/${batch.length} articles by index`);

    // Ensure all input articles have a result
    const results = batch.map((article, index) => {
      const batchResult = resultByIndex.get(index);
      if (batchResult) return batchResult;

      // Default to not relevant if missing from response
      return {
        id: article.id,
        relevant: false,
        relevanceReason: "missing_from_llm_response"
      };
    });

    return {
      results,
      latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      success: true
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[batch] LLM call failed:", err instanceof Error ? err.message : err);

    // On error, return all as not relevant (safe failure)
    return {
      results: batch.map((article) => ({
        id: article.id,
        relevant: false,
        relevanceReason: `llm_error: ${err instanceof Error ? err.message : "unknown"}`
      })),
      latencyMs: Date.now() - startTime,
      success: false,
      error: err instanceof Error ? err.message : "unknown_error"
    };
  }
}

/**
 * Validate that a summary meets word count requirements.
 */
export function isValidSummary(summary: string | undefined): boolean {
  if (!summary) return false;
  const words = countWords(summary);
  return words >= 35 && words <= 85; // Allow 35-85 words (relaxed to accommodate LLM variance)
}
