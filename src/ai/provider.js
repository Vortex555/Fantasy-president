import { completeAnthropic, anthropicInfo } from "./anthropic.js";
import { completeOpenAI, openAiInfo, discoverModel, probeLocal, forgetModel } from "./openai.js";
import { driftedFromEnglish, foreignScript, promptText, ENGLISH_RETRY } from "./english.js";

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

export const PROVIDERS = ["anthropic", "local", "off"];

/**
 * Which provider is configured.
 *
 * `FP_PROVIDER` decides explicitly. Left unset, an Anthropic key means the API
 * and no key means the offline engine — exactly what the game did before this
 * existed, so no existing setup changes behaviour.
 */
export function providerId() {
  const explicit = env("FP_PROVIDER").toLowerCase();
  if (PROVIDERS.includes(explicit)) return explicit;
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "off";
}

/**
 * `FP_PROVIDER` was set to something this does not recognise.
 *
 * Worth its own function because of how the failure actually presents. Node's
 * `--env-file` parses `KEY=value` per line, so an `.env` holding a whole shell
 * command —
 *
 *     FP_PROVIDER=local FP_LOCAL_URL=http://…/v1 npm start
 *
 * — sets FP_PROVIDER to the entire rest of the line and FP_LOCAL_URL to nothing.
 * The value then matches no provider, the fallback finds an API key sitting in
 * the shell, and the game quietly runs on the paid API while the player believes
 * it is running free on their own machine. Nothing anywhere said otherwise.
 *
 * Falling back is still right; doing it without a word is not.
 */
export function providerMisconfigured() {
  const raw = env("FP_PROVIDER");
  if (!raw || PROVIDERS.includes(raw.toLowerCase())) return null;
  return {
    value: raw,
    // The overwhelmingly common cause, and the one worth naming outright.
    looksLikeShellLine: /\s\w+=/.test(raw) || raw.includes(" "),
    resolvedTo: providerId(),
  };
}

/**
 * Whether a model is *configured* — not whether it answers.
 *
 * The distinction is the point. For a local provider there is always a URL,
 * because there is a default, so this can only ever tell you the game was asked
 * to use a model. It used to be read as "there is a model there", which is how
 * the game came to name a model on the title screen that it had never once
 * reached. `probeProvider()` is the version of this question with a real answer,
 * and `providerHealth()` is what the last actual call found out.
 */
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
/**
 * Say so when an answer ran into its own ceiling.
 *
 * The one failure in this system that hides. Every caller here is written to
 * degrade well — a malformed docket falls through to the hand-written pool, a
 * missing explanation falls back to the hand-written line — so a reply cut off
 * mid-JSON does not look like a fault. It looks like the fallback working.
 *
 * That is exactly how the floor's explanations shipped capped at 700 tokens:
 * the model answered for the first bill, the JSON was truncated, the other two
 * quietly used their templates, and nothing anywhere said a word. The reply was
 * two thirds missing and every symptom of it was indistinguishable from the
 * feature being off.
 *
 * So the ceiling reports itself. Ceilings are a runaway guard and nothing else —
 * length is the prompt's job — and any call that reaches one has almost
 * certainly lost something.
 */
function warnIfTruncated(req, out) {
  const ceiling = Number(req?.maxTokens);
  const used = Number(out?.usage?.out);
  if (!Number.isFinite(ceiling) || !Number.isFinite(used) || !used) return;
  // Servers vary by a token or two on where they stop, so this is not an equality.
  if (used < ceiling - 2) return;
  console.warn(
    `[truncated] a reply hit its ${ceiling}-token ceiling and was almost certainly cut off. `
    + `Raise maxTokens at the call site — the fallbacks will hide this otherwise.`
  );
}

/** One attempt at whichever provider is configured. */
const attempt = (id, req) => (id === "anthropic" ? completeAnthropic(req) : completeOpenAI(req));

/**
 * The answer, in the language the game is written in.
 *
 * A small model that drifts out of English does it silently and often only
 * partway — three stance cards in Mandarin under English headings, the JSON
 * perfectly well formed, every position correct. Nothing downstream can catch
 * that, because nothing downstream reads prose; it is a property of the reply
 * itself, so it belongs at the one point every reply in the game passes through.
 *
 * Asking again is the whole fix, and it nearly always works: the drift is a
 * lapse rather than a decision, and a model told plainly that it just answered
 * in the wrong language answers the same question again in the right one. That
 * is worth an extra call, because the alternative is the month falling back to
 * the hand-written pool for a reply whose only fault was its language.
 *
 * Twice is where it stops. A model that cannot stay in English through a direct
 * instruction is not going to on the third attempt, and throwing here is the
 * failure every caller in the game already knows how to survive.
 */
async function inEnglish(id, req) {
  /**
   * Checked against what was asked, not in isolation. A title or a name handed
   * to the model and handed straight back is our own material returning, and
   * counting it cost a real reply the first time this met a real model.
   */
  const given = promptText(req);

  const first = await attempt(id, req);
  if (!driftedFromEnglish(first.text, given)) return first;

  const { count, share, sample } = foreignScript(first.text, given);
  console.warn(`[language] the model wrote ${count} non-Latin characters of its own `
    + `(${Math.round(share * 100)}% of the reply, e.g. "${sample}"). Asking again in English.`);

  const second = await attempt(id, {
    ...req,
    system: [req.system, ENGLISH_RETRY].filter(Boolean).join("\n\n"),
    // The reminder is appended after the cached prefix, so the retry pays full
    // price for its input. It is one call in a rare failure; the alternative is
    // a cache breakpoint that moves every turn.
    cache: false,
  });
  if (!driftedFromEnglish(second.text, given)) return second;

  throw new Error("The model answered in another language twice; the game is English-only.");
}

export async function complete(req) {
  const id = providerId();
  if (id !== "anthropic" && id !== "local") {
    throw new Error("No model provider is configured.");
  }

  try {
    const out = await inEnglish(id, req);
    health = { ok: true, reason: null, at: Date.now(), failures: 0, id, model: out.model };
    warnIfTruncated(req, out);
    return out;
  } catch (err) {
    health = {
      ok: false, reason: err.message, at: Date.now(),
      failures: health.failures + 1, id, model: health.model,
    };
    // A local machine that just refused is a machine worth re-checking, and the
    // model it had may not be the model it has.
    if (id === "local") forgetModel();
    throw err;
  }
}

// --- Is it actually answering? ----------------------------------------------

/**
 * What the last real call discovered.
 *
 * Every model call in the game goes through `complete`, so this is always the
 * current truth regardless of which endpoint made the call. `ok: null` means
 * nothing has been asked yet — which is different from working and different
 * from broken, and the badge says so.
 */
let health = { ok: null, reason: null, at: 0, failures: 0, id: null, model: null };

export function providerHealth() {
  const id = providerId();
  // Health is per provider; switching provider invalidates what we knew, so
  // everything below reads the scoped value rather than the raw record. A local
  // model that was down says nothing about an API key that has just been set.
  const mine = health.id === id;
  const ok = mine ? health.ok : null;

  return {
    id,
    configured: aiAvailable(),
    ok,
    reason: mine ? health.reason : null,
    failures: mine ? health.failures : 0,
    model: mine ? health.model : null,
    checkedAt: mine ? health.at : 0,
    /**
     * The engine the game is actually playing on. This is the field the player
     * needs: "off" and "a local model that is not answering" produce identical
     * months, and only one of them used to admit it.
     */
    engine: id === "off" || ok === false ? "offline" : id,
  };
}

/** Called when a turn falls back, so the count reflects turns and not just calls. */
export function recordModelFailure(reason) {
  const id = providerId();
  health = { ok: false, reason, at: Date.now(), failures: health.failures + 1, id, model: health.model };
}

/** Wipe what we think we know, so the next question is asked for real. */
export function resetProviderHealth() {
  health = { ok: null, reason: null, at: 0, failures: 0, id: null, model: null };
  forgetModel();
}

/**
 * Ask the provider whether it is there, right now.
 *
 * Only the local path can be probed cheaply — an Anthropic key cannot be
 * verified without spending a token on it, so a configured key is taken at its
 * word and the first real call is what finds out.
 */
export async function probeProvider() {
  const id = providerId();
  if (id === "local") {
    const probe = await probeLocal();
    return { id, reachable: probe.reachable && Boolean(probe.model), ...probe };
  }
  if (id === "anthropic") {
    return {
      id, reachable: Boolean(process.env.ANTHROPIC_API_KEY), model: anthropicInfo().model,
      error: process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY is not set.",
    };
  }
  return { id, reachable: false, model: null, error: "No model provider is configured." };
}

export { discoverModel, forgetModel };
