import { localBaseUrl } from "./provider.js";

/**
 * Any OpenAI-compatible endpoint, which in practice means any model running on
 * the player's own machine.
 *
 * Ollama, LM Studio, llama.cpp's server, vLLM and LocalAI all implement
 * `/v1/chat/completions` closely enough that one adapter serves all of them.
 * The differences that matter are not in the protocol but in the model: a 7B
 * running on a laptop is slower than an API call by an order of magnitude and
 * markedly worse at holding a large JSON shape together, and both of those are
 * handled here rather than being allowed to reach the game.
 */

const env = (key, fallback = "") => (process.env[key] || "").trim() || fallback;

/**
 * How long to wait. A local model on CPU can take minutes on a long structured
 * answer, and killing it at the usual thirty seconds would make the mode look
 * broken when it is merely slow.
 */
const TIMEOUT_MS = Number(env("FP_LOCAL_TIMEOUT_MS", "180000"));

const MODELS = {
  judge: () => env("FP_LOCAL_MODEL"),
  chat: () => env("FP_LOCAL_CHAT_MODEL") || env("FP_LOCAL_MODEL"),
};

/** Cached so the game does not re-interrogate the server on every single turn. */
let discovered = null;

/**
 * What the server actually has loaded.
 *
 * Asking beats guessing: players pull whatever model they like, and requiring
 * them to also set an environment variable to name it is a step that will be
 * skipped and then reported as a bug.
 */
export async function discoverModel() {
  if (discovered !== null) return discovered;
  try {
    const res = await fetch(`${localBaseUrl()}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return (discovered = "");
    const body = await res.json();
    const first = (body?.data || [])[0]?.id || "";
    return (discovered = first);
  } catch {
    return (discovered = "");
  }
}

/** Forget what we found, so a player can switch models without a restart. */
export const forgetModel = () => { discovered = null; };

async function resolveModel(tier) {
  return MODELS[tier]?.() || MODELS.judge() || (await discoverModel());
}

export async function openAiInfo() {
  const url = localBaseUrl();
  const model = (await resolveModel("judge")) || "(none loaded)";
  return {
    label: "Local model",
    detail: `Running on your own machine at ${url} — nothing is sent anywhere and nothing is billed.`,
    model,
    chatModel: (await resolveModel("chat")) || model,
    url,
    local: true,
  };
}

export async function completeOpenAI({
  system, messages, tier = "judge", maxTokens = 1600, temperature = 0.8, json = false,
}) {
  const model = await resolveModel(tier);
  if (!model) {
    throw new Error(
      `No local model available at ${localBaseUrl()}. Pull one (for example \`ollama pull qwen2.5:7b\`) ` +
      `or set FP_LOCAL_MODEL.`
    );
  }

  const res = await fetch(`${localBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Some local servers demand a bearer token and ignore its value.
      Authorization: `Bearer ${env("FP_LOCAL_KEY", "local")}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
      temperature,
      stream: false,
      // Constrained decoding where the server supports it. Servers that do not
      // simply ignore the field, which is why the parser downstream still has
      // to be forgiving.
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Local model returned ${res.status}. ${detail.slice(0, 200)}`);
  }

  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content ?? "";
  return {
    text,
    model: body?.model || model,
    // Normalised to the same shape the Anthropic path returns, so the usage
    // log reads the same whichever brain answered.
    usage: {
      in: body?.usage?.prompt_tokens ?? 0,
      out: body?.usage?.completion_tokens ?? 0,
      cached: 0,
    },
  };
}
