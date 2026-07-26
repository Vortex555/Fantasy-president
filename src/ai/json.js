/**
 * Getting a JSON object out of a model that promised one.
 *
 * The hosted models return exactly what was asked for. A 7B running on a laptop
 * returns the object wrapped in a code fence, or prefaced with "Here is the
 * JSON:", or with a trailing comma before the closing brace, or truncated
 * mid-string because it hit the token ceiling. None of that is the game's
 * fault and none of it should reach the game, so this is deliberately
 * forgiving in the order that costs least: try it clean, then unwrap, then
 * repair, and only then give up.
 *
 * Giving up is a real option. Every caller has a deterministic fallback, so a
 * model that cannot hold the shape together produces a shallower month rather
 * than a broken one.
 */

/** Strip the things a chatty model puts around an object. */
function unwrap(text) {
  let t = String(text ?? "").trim();
  // ```json … ``` or ``` … ```
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Anything before the first brace or after the last is commentary.
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  return t.trim();
}

/**
 * The repairs worth attempting, cheapest first. Each is a real failure seen
 * from small local models rather than a hypothetical.
 */
function repair(text) {
  return text
    // Trailing commas before a close: {"a":1,} and [1,2,]
    .replace(/,\s*([}\]])/g, "$1")
    // Smart quotes, which some models emit inside prose fields.
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // Literal newlines inside a string are invalid JSON; models do it anyway.
    .replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/\n/g, "\\n"))
    // NaN / Infinity are not JSON numbers.
    .replace(/:\s*(NaN|-?Infinity)\s*([,}])/g, ": null$2");
}

/**
 * Close an object that was cut off mid-flight.
 *
 * A truncated response is the single commonest local-model failure — the model
 * hits max_tokens partway through the press array — and a half-object with its
 * braces balanced is worth far more than nothing, because every field the game
 * reads is optional and defaulted.
 */
function closeTruncated(text) {
  let t = text;
  // Drop a dangling partial string.
  const quotes = (t.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 === 1) t = t.slice(0, t.lastIndexOf('"'));
  // Drop a dangling key, whether it is the first in the object or a later one.
  // Without the first-key case, `{"analysis"` closes to `{"analysis"}` — which
  // is still not JSON, and the whole turn is lost for want of one brace.
  t = t
    .replace(/,\s*"[^"]*"?\s*:?\s*$/, "")
    .replace(/([{[])\s*"[^"]*"?\s*:?\s*$/, "$1")
    .replace(/[,:]\s*$/, "");

  const opens = (t.match(/[{[]/g) || []).length;
  const closes = (t.match(/[}\]]/g) || []).length;
  if (opens <= closes) return t;

  // Close whatever is still open, innermost first.
  const stack = [];
  let inString = false, escaped = false;
  for (const ch of t) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  while (stack.length) t += stack.pop() === "{" ? "}" : "]";
  return t;
}

/**
 * Parse, or throw. Throwing is fine — callers fall back to the offline engine.
 */
export function parseModelJson(text) {
  const attempts = [
    (t) => t,
    unwrap,
    (t) => repair(unwrap(t)),
    (t) => closeTruncated(repair(unwrap(t))),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt(text));
      // An array is an object to `typeof` and useless to every caller here.
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Model did not return usable JSON: ${lastError?.message || "unknown"}`);
}

/** Parse, or return null. For callers that would rather branch than catch. */
export function tryParseModelJson(text) {
  try {
    return parseModelJson(text);
  } catch {
    return null;
  }
}
