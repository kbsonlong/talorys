import type { Env } from "../env";

export interface WorkersAIModel {
  id: string;
  name: string;
  description?: string;
  task?: string;
  source: "cloudflare" | "fallback";
}

/** Public Cloudflare-hosted text-generation models that work with the Workers AI binding. */
export const FALLBACK_CHAT_MODELS: WorkersAIModel[] = [
  { id: "@cf/zai-org/glm-4.7-flash", name: "GLM 4.7 Flash", task: "Text Generation", source: "fallback" },
  { id: "@cf/meta/llama-3.2-3b-instruct", name: "Llama 3.2 3B Instruct", task: "Text Generation", source: "fallback" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8-fast", name: "Llama 3.1 8B Instruct", task: "Text Generation", source: "fallback" },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B A3B", task: "Text Generation", source: "fallback" },
  { id: "@cf/google/gemma-3-12b-it", name: "Gemma 3 12B IT", task: "Text Generation", source: "fallback" },
  { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1", task: "Text Generation", source: "fallback" },
  { id: "@cf/openai/gpt-oss-20b", name: "GPT OSS 20B", task: "Text Generation", source: "fallback" },
];

function normalizeModel(raw: unknown): WorkersAIModel | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.model === "string" ? item.model : typeof item.id === "string" ? item.id : null;
  if (!id || !id.startsWith("@cf/")) return null;
  const task = typeof item.task === "string" ? item.task : typeof item.task_name === "string" ? item.task_name : undefined;
  if (task && !/text\s*generation/i.test(task)) return null;
  return {
    id,
    name: typeof item.name === "string" ? item.name : id.slice(4),
    description: typeof item.description === "string" ? item.description : undefined,
    task,
    source: "cloudflare",
  };
}

export async function discoverWorkersAIModels(
  env: Env,
): Promise<{ models: WorkersAIModel[]; source: "cloudflare" | "fallback"; warning?: string }> {
  const fallback = [...FALLBACK_CHAT_MODELS];
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return { models: fallback, source: "fallback", warning: "Cloudflare API credentials are not configured." };
  }
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/models/search`);
  url.searchParams.set("task", "Text Generation");
  url.searchParams.set("hide_experimental", "true");
  url.searchParams.set("per_page", "100");
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`Cloudflare API returned ${response.status}`);
    const payload = (await response.json()) as { success?: boolean; result?: unknown };
    const raw = Array.isArray(payload.result)
      ? payload.result
      : payload.result && typeof payload.result === "object" && Array.isArray((payload.result as { data?: unknown }).data)
        ? (payload.result as { data: unknown[] }).data
        : [];
    const models = raw.map(normalizeModel).filter((model): model is WorkersAIModel => !!model);
    const deduped = [...new Map(models.map((model) => [model.id, model])).values()];
    if (!deduped.length) throw new Error("Cloudflare returned no usable text-generation models");
    return { models: deduped, source: "cloudflare" };
  } catch (error) {
    console.warn("Workers AI model discovery failed", error);
    return { models: fallback, source: "fallback", warning: "Cloudflare model discovery is unavailable; showing built-in models." };
  }
}
