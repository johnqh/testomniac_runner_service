import type OpenAI from "openai";
import type { ApiClient } from "../api/client";

export async function trackOpenAiCall(
  api: ApiClient,
  scanId: number,
  phase: string,
  purpose: string,
  callFn: () => Promise<OpenAI.Chat.Completions.ChatCompletion>
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const response = await callFn();
  const usage = response.usage;
  if (usage) {
    await api.recordAiUsage({
      scanId,
      phase,
      model: response.model,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      purpose,
    });
  }
  return response;
}
