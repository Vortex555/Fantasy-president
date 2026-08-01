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
 *
 * The machine is also, unlike an API, *sometimes not there* — asleep, not
 * started yet, on a different address than it was yesterday. Everything below
 * assumes that is normal rather than exceptional.
 */

const env = (key, fallback = "") => (process.env[key] || "").trim() || fallback;

/**
 * How long to wait. A local model on CPU can take minutes on a long structured
 * answer, and killing it at the usual thirty seconds would make the mode look
 * broken when it is merely slow.
 *
 * Read at call time, not at import: captured once, a value cannot be changed by
 * anything — including a test that needs a request to give up quickly.
 */
const timeoutMs = () => Number(env("FP_LOCAL_TIMEOUT_MS", "180000")) || 180000;

/**
 * How long to sit on a *failed* discovery before asking the machine again.
 *
 * This number is the whole bug that this file used to have. A failure was
 * cached forever, so a game started thirty seconds before the model server came
 * up would play its entire term on the offline engine and never ask again.
 */
const retryAfterMs = () => {
  const raw = Number(env("FP_LOCAL_RETRY_MS", "15000"));
  return Number.isFinite(raw) && raw >= 0 ? raw : 15000;
};

/** Reaching the machine should be quick or not at all; generating should not. */
const PROBE_TIMEOUT_MS = 5000;

const MODELS = {
  judge: () => env("FP_LOCAL_MODEL"),
  chat: () => env("FP_LOCAL_CHAT_MODEL") || env("FP_LOCAL_MODEL"),
};

/**
 * What the server had loaded, and when we last managed to ask.
 *
 * A model we found is cached until something forgets it — re-interrogating the
 * server every turn is waste. A failure is cached only for the retry window,
 * because a failure is usually a machine that is about to be there.
 */
let discovery = { model: "", ok: false, at: 0 };

const remember = (model) => { discovery = { model, ok: Boolean(model), at: Date.now() }; };

/**
 * What the server actually has loaded.
 *
 * Asking beats guessing: players pull whatever model they like, and requiring
 * them to also set an environment variable to name it is a step that will be
 * skipped and then reported as a bug.
 */
export async function discoverModel() {
  if (discovery.ok) return discovery.model;
  if (discovery.at && Date.now() - discovery.at < retryAfterMs()) return discovery.model;
  remember(await askForModel());
  return discovery.model;
}

async function askForModel() {
  try {
    const res = await fetch(`${localBaseUrl()}/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return "";
    const body = await res.json().catch(() => null);
    return (body?.data || [])[0]?.id || "";
  } catch {
    return "";
  }
}

/** Forget what we found, so a player can switch models without a restart. */
export const forgetModel = () => { discovery = { model: "", ok: false, at: 0 }; };

async function resolveModel(tier) {
  return MODELS[tier]?.() || MODELS.judge() || (await discoverModel());
}

/**
 * Is there actually something there?
 *
 * `aiAvailable()` can only tell you that a URL was configured, which for a local
 * provider is always true because there is a default. This asks the machine and
 * reports what it said, so the game can tell the player the truth instead of
 * naming a model it has never reached.
 *
 * A server that answers `/models` with a 404 is still a server — llama.cpp does
 * exactly that — so *reachable* means the connection worked, not that the
 * listing did.
 */
export async function probeLocal() {
  const url = localBaseUrl();
  const configured = MODELS.judge();

  try {
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    let listed = "";
    if (res.ok) {
      const body = await res.json().catch(() => null);
      listed = (body?.data || [])[0]?.id || "";
      if (listed) remember(listed);
    }
    const model = configured || listed;
    return {
      reachable: true,
      url,
      model,
      listed: Boolean(listed),
      error: model ? null
        : `Reached ${url}, but it has no model loaded and FP_LOCAL_MODEL is not set.`,
    };
  } catch (err) {
    return {
      reachable: false,
      url,
      model: configured,
      listed: false,
      error: `Could not reach ${url} — ${describeFetchError(err)}.`,
    };
  }
}

/** Fetch failures in plain English, because the player has to act on this. */
function describeFetchError(err) {
  if (err?.name === "TimeoutError") return "it did not answer in time";
  const cause = err?.cause?.code || "";
  if (cause === "ECONNREFUSED") return "nothing is listening there";
  if (cause === "ENOTFOUND" || cause === "EAI_AGAIN") return "that host could not be found";
  if (cause === "EHOSTUNREACH" || cause === "ENETUNREACH") return "that machine is not reachable on the network";
  return err?.message || "the connection failed";
}

export async function openAiInfo() {
  const url = localBaseUrl();
  const probe = await probeLocal();
  const model = probe.model || "(none loaded)";
  return {
    label: "Local model",
    detail: probe.reachable && probe.model
      ? `Running on your own machine at ${url} — nothing is sent anywhere and nothing is billed.`
      : probe.error,
    model,
    chatModel: (await resolveModel("chat")) || model,
    url,
    local: true,
    // What the machine actually said, so nobody downstream has to assume.
    reachable: probe.reachable && Boolean(probe.model),
    error: probe.error,
  };
}

export async function completeOpenAI({
  system, messages, tier = "judge", maxTokens = 4096, temperature = 0.8, json = false,
}) {
  const model = await resolveModel(tier);
  if (!model) {
    throw new Error(
      `No local model available at ${localBaseUrl()}. Pull one (for example \`ollama pull qwen2.5:7b\`) ` +
      `or set FP_LOCAL_MODEL.`
    );
  }

  let res;
  try {
    res = await fetch(`${localBaseUrl()}/chat/completions`, {
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
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (err) {
    // The machine went away mid-game. Forget what we knew about it so the next
    // attempt re-checks rather than retrying a model that may no longer be there.
    forgetModel();
    if (err?.name === "TimeoutError") {
      throw new Error(
        `The local model at ${localBaseUrl()} did not answer within ` +
        `${Math.round(timeoutMs() / 1000)}s. Raise FP_LOCAL_TIMEOUT_MS, or use a smaller model.`
      );
    }
    throw new Error(`Could not reach the local model at ${localBaseUrl()} — ${describeFetchError(err)}.`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // A 404 here usually means the model we asked for is not the model it has.
    if (res.status === 404) forgetModel();
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
