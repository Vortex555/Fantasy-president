import { completeAnthropic, anthropicInfo } from "./anthropic.js";
import { completeOpenAI, openAiInfo, discoverModel } from "./openai.js";

/**
 * Where the intelligence comes from.
 *
 * The game has always had two modes — Anthropic's API, or a deterministic
 * keyword engine when there is no key. This adds a third: a model running on
 * the player's own machine, which costs nothing and sends nothing anywhere.
 *
 * One adapter covers every local runner worth naming. Ollama, LM Studio,
 * llama.cpp's server, vLLM and LocalAI all speak the OpenAI chat-completions
 * shape, so "local" is a base URL and a model name rather than five separate
 * integrations.
 *
 * Every call names a *tier* rather than a model. The judge decides consequences
 * and needs to be good; the flavour writes voter quotes and does not. On the
 * API those are two different models at a fifth the price; locally they are
 * usually the same weights, and the distinction costs nothing to keep.
 */

export const TIERS = ["judge", "chat"];

const env = (key, fallback = "") => (process.env[key] || "").trim() || fallback;

/**
 * Which provider is configured.
 *
 * `FP_PROVIDER` decides explicitly. Left unset, an Anthropic key means the API
 * and no key means the offline engine — exactly what the game did before this
 * existed, so no existing setup changes behaviour.
 */
export function providerId() {
  const explicit = env("FP_PROVIDER").toLowerCase();
  if (["anthropic", "local", "off"].includes(explicit)) return explicit;
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "off";
}

/** Whether there is a model of any kind to talk to. */
export function aiAvailable() {
  const id = providerId();
  if (id === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (id === "local") return Boolean(localBaseUrl());
  return false;
}

export const localBaseUrl = () =>
  env("FP_LOCAL_URL", "http://localhost:11434/v1").replace(/\/+$/, "");

/**
 * What to tell the player about where their turns are coming from. The client
 * shows this on the title screen, because "which brain is running this" is
 * something a player should never have to guess at.
 */
export async function providerInfo() {
  const id = providerId();
  if (id === "anthropic") return { id, ...anthropicInfo(), available: aiAvailable() };
  if (id === "local") return { id, ...(await openAiInfo()), available: aiAvailable() };
  return {
    id: "off",
    label: "Local simulation",
    detail: "No model configured. The built-in engine plays every month offline.",
    available: false,
  };
}

/**
 * One completion, whoever is answering.
 *
 * @param {object}  req
 * @param {string}  req.system     the system prompt
 * @param {Array}   req.messages   [{ role: "user"|"assistant", content }]
 * @param {string}  req.tier       "judge" | "chat"
 * @param {number}  req.maxTokens
 * @param {boolean} req.json       ask for a JSON object and mean it
 * @param {number}  req.temperature
 * @param {boolean} req.cache      let the provider cache the system prefix
 * @returns {Promise<{ text: string, usage: object, model: string }>}
 */
export async function complete(req) {
  const id = providerId();
  if (id === "anthropic") return completeAnthropic(req);
  if (id === "local") return completeOpenAI(req);
  throw new Error("No model provider is configured.");
}

export { discoverModel };
