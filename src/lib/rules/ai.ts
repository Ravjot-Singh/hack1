// AI fallback for plain-English rules. Server-only (reads API keys). One provider is used,
// chosen by LLM_PROVIDER: "anthropic" (Claude, ANTHROPIC_API_KEY) or "xai" (Grok, XAI_API_KEY).
// Callers only reach this after the built-in parser gave up and the admin asked for it.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { aiRuleSchema, contextPrompt, SYSTEM_PROMPT, type AiRule } from "./ai-spec";
import type { RuleContext } from "./draft";

export interface AiProvider {
  id: "anthropic" | "xai";
  label: "Claude" | "Grok";
  model: string;
}

/** The configured provider, or null when no key is set (the AI button is then hidden). */
export function aiProvider(): AiProvider | null {
  const want = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const anthropic: AiProvider | null = process.env.ANTHROPIC_API_KEY
    ? { id: "anthropic", label: "Claude", model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5" }
    : null;
  const xai: AiProvider | null = process.env.XAI_API_KEY
    ? { id: "xai", label: "Grok", model: process.env.XAI_MODEL || "grok-4.20-0309-non-reasoning" }
    : null;
  if (want === "xai" || want === "grok") return xai;
  if (want === "anthropic" || want === "claude") return anthropic;
  return anthropic ?? xai;
}

export type AiResult =
  | { ok: true; rule: AiRule; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; error: string };

export async function interpretWithAi(provider: AiProvider, text: string, ctx: RuleContext): Promise<AiResult> {
  const user = `${contextPrompt(ctx)}\n\nSentence: ${text}`;
  try {
    return provider.id === "anthropic" ? await viaClaude(provider.model, user) : await viaGrok(provider.model, user);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

async function viaClaude(model: string, user: string): Promise<AiResult> {
  const client = new Anthropic({ maxRetries: 1, timeout: 60_000 });
  const res = await client.beta.messages.parse({
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: user }],
    // A short extraction: low effort keeps the call quick and cheap.
    output_config: { effort: "low", format: betaZodOutputFormat(aiRuleSchema) },
    // If the model declines, Anthropic retries on its recommended fallback model server-side.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") return { ok: false, error: "Claude declined to read that sentence." };
  if (res.stop_reason === "max_tokens" || !res.parsed_output) return { ok: false, error: "Claude's answer was incomplete. Try a shorter sentence." };
  return { ok: true, rule: res.parsed_output, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
}

async function viaGrok(model: string, user: string): Promise<AiResult> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "rule", schema: z.toJSONSchema(aiRuleSchema), strict: true } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) return { ok: false, error: "The Grok API key was rejected. Check XAI_API_KEY." };
    if (res.status === 429) return { ok: false, error: "Grok's rate limit or credit was reached. Try again later." };
    return { ok: false, error: `Grok returned an error (${res.status}). ${body.slice(0, 160)}` };
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string; refusal?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) return { ok: false, error: "Grok declined to read that sentence." };
  const parsed = aiRuleSchema.safeParse(JSON.parse(choice?.message?.content ?? "null"));
  if (!parsed.success) return { ok: false, error: "Grok's answer wasn't in the expected format." };
  return { ok: true, rule: parsed.data, inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null };
}

function friendly(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.RateLimitError) return "Claude's rate limit was reached. Try again in a minute.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? "network"}).`;
  if (e instanceof Error && e.name === "TimeoutError") return "The AI took too long to answer. Try again.";
  return "Couldn't reach the AI service.";
}
