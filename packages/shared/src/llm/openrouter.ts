import { z } from "zod";
import { ensureExactly60Words } from "../utils/wordCount.js";

export interface SummaryInput {
  headline: string;
  body?: string;
  sourceLanguage: string;
}

export interface SummaryResult {
  summary60: string;
  model: string;
  provider: string;
  attempts: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TranslationInput {
  text: string;
  sourceLanguage: string;
}

export interface TranslationResult {
  translatedText: string;
  model: string;
  provider: string;
  attempts: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface OpenRouterOptions {
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
  endpoint?: string;
  appName?: string;
  appUrl?: string;
}

const OpenRouterResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string()
      })
    })
  ),
  provider: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional()
    })
    .optional()
});

export function buildSummaryPrompt(input: SummaryInput): string {
  return [
    "You are a news summarizer for a Web3 news app.",
    "Task: Output exactly 60 words in English.",
    "Rules:",
    "1) Be factual and neutral.",
    "2) Do not add claims not supported by the source text.",
    "3) If source text is non-English, translate meaning first and still output English.",
    "4) No bullet points.",
    "5) Output plain text only.",
    "INPUT_HEADLINE:",
    input.headline,
    "INPUT_BODY:",
    input.body ?? "",
    "SOURCE_LANGUAGE:",
    input.sourceLanguage
  ].join("\n");
}

export function buildTranslationPrompt(input: TranslationInput): string {
  return [
    "You are a translation engine for a Web3 news pipeline.",
    "Task: Translate input text into natural English.",
    "Rules:",
    "1) Keep facts unchanged and do not summarize.",
    "2) Keep named entities and numbers accurate.",
    "3) Output plain English text only.",
    "SOURCE_LANGUAGE:",
    input.sourceLanguage,
    "INPUT_TEXT:",
    input.text
  ].join("\n");
}

export function parseSummaryResponse(raw: string): string {
  return raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/i, "")
    .replace(/^summary\s*:\s*/i, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function parseTranslationResponse(raw: string): string {
  return parseSummaryResponse(raw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelayMs(attempt: number, isAbort = false): number {
  const base = isAbort ? 600 : 350;
  return base * (2 ** Math.max(0, attempt - 1));
}

async function callOpenRouter(
  options: OpenRouterOptions,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<{ content: string; provider: string; inputTokens?: number; outputTokens?: number }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...(options.appName ? { "X-Title": options.appName } : {}),
          ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {})
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: maxTokens,
          messages: [
            {
              role: "system",
              content: "You strictly follow output constraints."
            },
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const body = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 3) {
          await sleep(retryDelayMs(attempt));
          continue;
        }

        throw new Error(`OpenRouter error (${response.status}): ${body}`);
      }

      const parsed = OpenRouterResponseSchema.parse(await response.json());
      const content = parsed.choices[0]?.message.content;

      if (!content) {
        throw new Error("OpenRouter returned empty content");
      }

      return {
        content,
        provider: parsed.provider ?? "openrouter",
        inputTokens: parsed.usage?.prompt_tokens,
        outputTokens: parsed.usage?.completion_tokens
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt < 3) {
        await sleep(retryDelayMs(attempt, isAbort));
        continue;
      }
      throw isAbort ? new Error("OpenRouter request timed out after 30s") : err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("OpenRouter request failed after retries");
}

export async function summarizeWithFallback(
  input: SummaryInput,
  options: OpenRouterOptions
): Promise<SummaryResult> {
  const prompt = buildSummaryPrompt(input);
  // COST OPTIMIZATION: Primary model only, no fallback
  const models = [options.primaryModel];
  let attempts = 0;

  for (const model of models) {
    // COST OPTIMIZATION: No retries - each attempt is billed
    for (let retry = 0; retry < 1; retry += 1) {
      attempts += 1;
      const { content, provider, inputTokens, outputTokens } = await callOpenRouter(options, model, prompt, 220);
      const summary = parseSummaryResponse(content);
      const validation = ensureExactly60Words(summary);

      if (validation.ok) {
        return {
          summary60: summary,
          model,
          provider,
          attempts,
          inputTokens,
          outputTokens
        };
      }
    }
  }

  throw new Error("Failed to generate exactly 60-word summary after all attempts");
}

export async function translateToEnglishWithFallback(
  input: TranslationInput,
  options: OpenRouterOptions
): Promise<TranslationResult> {
  const prompt = buildTranslationPrompt(input);
  // COST OPTIMIZATION: Primary model only, no fallback
  const models = [options.primaryModel];
  let attempts = 0;

  for (const model of models) {
    // COST OPTIMIZATION: No retries - each attempt is billed
    for (let retry = 0; retry < 1; retry += 1) {
      attempts += 1;
      const { content, provider, inputTokens, outputTokens } = await callOpenRouter(options, model, prompt, 600);
      const translated = parseTranslationResponse(content);

      if (translated.length > 0) {
        return {
          translatedText: translated,
          model,
          provider,
          attempts,
          inputTokens,
          outputTokens
        };
      }
    }
  }

  throw new Error("Failed to translate to English after all attempts");
}

// ============================================================
// Input sanitization for prompt injection protection
// ============================================================

/**
 * Sanitizes untrusted user content before including in prompts.
 * Prevents prompt injection attacks by escaping control sequences.
 */
export function sanitizeForPrompt(input: string): string {
  return input
    // Remove any instruction-like patterns
    .replace(/\b(ignore|disregard|forget)\s+(previous|above|all|prior)\s+(instructions?|prompts?|rules?)/gi, "[FILTERED]")
    // Remove role-switching attempts
    .replace(/\b(system|assistant|user)\s*:/gi, "[ROLE]:")
    // Remove XML/HTML-like injection attempts (but keep safe tags we control)
    .replace(/<\/(system|assistant|prompt|instructions?)>/gi, "[/TAG]")
    .replace(/<(system|assistant|prompt|instructions?)[^>]*>/gi, "[TAG]")
    // Limit length to prevent context stuffing
    .slice(0, 10000)
    .trim();
}

/**
 * Wraps untrusted content in XML tags for clear boundary separation.
 * Use this when including external data in prompts.
 */
export function wrapUntrustedContent(content: string, tag: string): string {
  const sanitized = sanitizeForPrompt(content);
  return `<${tag}>\n${sanitized}\n</${tag}>`;
}

// ============================================================
// Multi-agent pipeline support
// ============================================================

export interface AgentConfig {
  apiKey: string;
  model: string;
  appName?: string;
  appUrl?: string;
  endpoint?: string;
  /** If true, adds OpenRouter web search plugin to the request */
  useWebSearch?: boolean;
  /** If "json", adds response_format: {type: "json_object"} */
  responseFormat?: "text" | "json";
  /** Timeout in ms for LLM requests. Default 30_000 (30s). */
  timeoutMs?: number;
  /** Temperature 0-1. Default 0 for deterministic outputs. */
  temperature?: number;
}

export interface AgentLLMResult {
  content: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Generic LLM call for pipeline agents.
 * Supports JSON mode and web search plugin (OpenRouter).
 */
export async function callAgentLLM(
  config: AgentConfig,
  userPrompt: string,
  systemPrompt: string,
  maxTokens: number
): Promise<AgentLLMResult> {
  const endpoint = config.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";

  const body: Record<string, unknown> = {
    model: config.model,
    temperature: config.temperature ?? 0, // Default to 0 for deterministic outputs
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  if (config.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  if (config.useWebSearch) {
    body.plugins = [{ id: "web" }];
  }

  const timeoutMs = config.timeoutMs ?? 30_000;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          ...(config.appName ? { "X-Title": config.appName } : {}),
          ...(config.appUrl ? { "HTTP-Referer": config.appUrl } : {})
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const responseBody = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 3) {
          await sleep(retryDelayMs(attempt));
          continue;
        }
        throw new Error(`Agent LLM error (${response.status}): ${responseBody}`);
      }

      const parsed = OpenRouterResponseSchema.parse(await response.json());
      const content = parsed.choices[0]?.message.content;

      if (!content) {
        throw new Error("Agent LLM returned empty content");
      }

      return {
        content,
        provider: parsed.provider ?? "openrouter",
        inputTokens: parsed.usage?.prompt_tokens,
        outputTokens: parsed.usage?.completion_tokens
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (attempt < 3) {
        await sleep(retryDelayMs(attempt, isAbort));
        continue;
      }
      throw isAbort
        ? new Error(`Agent LLM request timed out after ${timeoutMs}ms`)
        : err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Agent LLM request failed after all retries");
}
