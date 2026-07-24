"use strict";

/** Every server call the client makes, in one place. */

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: "The server sent back something unreadable." }));
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export async function getMeta() {
  try {
    const res = await fetch("/api/meta");
    return await res.json();
  } catch {
    return { ai: false, states: {}, stakeholders: [] };
  }
}

export const startGame = (scenario) => post("/api/start", { scenario });

export const playTurn = (state, event, policy, publicMessage) =>
  post("/api/turn", { state, event, policy, publicMessage });

export const askAdvisor = (state, event, advisorId, history, message) =>
  post("/api/advisor", { state, event, advisorId, history, message });

export const dismissAdvisor = (state, advisorId) =>
  post("/api/cabinet/order", { state, advisorId, action: "fire" });

export const debateRound = (state, round, topic, playerLine, history) =>
  post("/api/debate", { state, round, topic, playerLine, history });

export const finishCampaign = (state, debateScore) =>
  post("/api/campaign/finish", { state, debateScore });
