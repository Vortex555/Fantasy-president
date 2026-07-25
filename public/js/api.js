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

// --- Institutional positions ----------------------------------------------

export const institutionCandidates = (state, institutionId) =>
  post("/api/institutions/candidates", { state, institutionId });

export const appointOfficial = (state, institutionId, candidateKey) =>
  post("/api/institutions/appoint", { state, institutionId, candidateKey });

export const dismissOfficial = (state, institutionId) =>
  post("/api/institutions/dismiss", { state, institutionId });

// --- Special actions -------------------------------------------------------

export const availableActions = (state) => post("/api/actions/available", { state });

export const proposeAction = (state, actionId) => post("/api/actions/propose", { state, actionId });

// --- The East Wing ---------------------------------------------------------

export const deployEastWing = (state, instruction) =>
  post("/api/firstlady/deploy", { state, instruction });

export const editFirstLady = (state, name, causeId) =>
  post("/api/firstlady/edit", { state, name, causeId });

// --- Bills on your desk ----------------------------------------------------

export const actOnBill = (state, billId, action) =>
  post("/api/bills/act", { state, billId, action });
