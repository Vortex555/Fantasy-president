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

export const startGame = (scenario, career = null) => post("/api/start", { scenario, career });

/** Is the model answering? `recheck` makes the server ask the machine again. */
export const aiStatus = (recheck = false) => post("/api/ai/status", { recheck });

export const playTurn = (state, event, policy, publicMessage) =>
  post("/api/turn", { state, event, policy, publicMessage });

export const askAdvisor = (state, event, advisorId, history, message) =>
  post("/api/advisor", { state, event, advisorId, history, message });

export const dismissAdvisor = (state, advisorId) =>
  post("/api/cabinet/order", { state, advisorId, action: "fire" });

export const debateRound = (state, round, topic, playerLine, history) =>
  post("/api/debate", { state, round, topic, playerLine, history });

export const finishCampaign = (state, debateScore, spend) =>
  post("/api/campaign/finish", { state, debateScore, spend });

// --- Elections -------------------------------------------------------------

export const midtermBoard = (state) => post("/api/midterms/board", { state });

export const finishMidterms = (state, spend) => post("/api/midterms/finish", { state, spend });

export const getVerdict = (state) => post("/api/verdict", { state });

// --- The House -------------------------------------------------------------

export const houseDistricts = (party, presidentName, startYear) =>
  post("/api/house/districts", { party, presidentName, startYear });

export const houseFloor = (state) => post("/api/house/floor", { state });

/** Forcing the floor: the one agenda power that needs no rank. */
export const filePetition = (state, billId, favours) =>
  post("/api/chamber/petition", { state, action: "launch", billId, favours });
export const pushPetition = (state, favours) =>
  post("/api/chamber/petition", { state, action: "sign", favours });

export const houseVote = (state, bill, vote) => post("/api/house/vote", { state, bill, vote });

export const houseSponsor = (state, title, axis, domain, favours = 0) =>
  post("/api/house/sponsor", { state, title, axis, domain, favours });

export const houseAdvance = (state) => post("/api/house/advance", { state });

export const houseCommittee = (state, bill, action) =>
  post("/api/house/committee", { state, bill, action });

export const houseWhip = (state, bill, amount) =>
  post("/api/house/whip", { state, bill, amount });

export const houseArticles = (state, vote) => post("/api/house/articles", { state, vote });

// --- The Senate ------------------------------------------------------------

export const senateStates = (party, presidentName, startYear) =>
  post("/api/senate/states", { party, presidentName, startYear });

export const senateFloor = (state) => post("/api/senate/floor", { state });

export const senateVote = (state, bill, vote) => post("/api/senate/vote", { state, bill, vote });

export const senateFilibuster = (state, bill) => post("/api/senate/filibuster", { state, bill });

export const senateAdvance = (state) => post("/api/senate/advance", { state });

export const senateSponsor = (state, title, axis, domain, favours = 0) =>
  post("/api/senate/sponsor", { state, title, axis, domain, favours });

export const senateCommittee = (state, bill, action) =>
  post("/api/senate/committee", { state, bill, action });

export const senateWhip = (state, bill, amount) =>
  post("/api/senate/whip", { state, bill, amount });

export const senateArticles = (state, vote) => post("/api/senate/articles", { state, vote });

export const senateConfirm = (state, vote) => post("/api/senate/confirm", { state, vote });

export const houseVerdict = (state) => post("/api/house/verdict", { state });

/**
 * Your own office, in both chambers. A member's equivalent of the cabinet chat:
 * the only person in the building whose job is what a vote costs *you*.
 */
export const chamberStaff = (state, history, message) =>
  post("/api/chamber/staff", { state, history, message });

/** Everything a career has done to the country, read out of the monthly record. */
export const chamberCountry = (state) => post("/api/chamber/country", { state });

// --- The statehouses -------------------------------------------------------

export const getGovernors = (state) => post("/api/governors", { state });

export const courtGovernor = (state, code) => post("/api/governors/court", { state, code });

// --- The primary -----------------------------------------------------------

export const primaryBoard = (state) => post("/api/primary/board", { state });

export const finishPrimary = (state, strategy) => post("/api/primary/finish", { state, strategy });

// --- Leaving office --------------------------------------------------------

export const resignOffice = (state) => post("/api/resign", { state });

export const twentyFifthStanding = (state) => post("/api/twentyfifth/standing", { state });

export const answerTwentyFifth = (state, action) =>
  post("/api/twentyfifth/resolve", { state, action });

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

// --- The ladder ------------------------------------------------------------

export const ladderChoices = (career, state) => post("/api/ladder/choices", { career, state });

export const ladderRace = (career, state, opts) =>
  post("/api/ladder/race", { career, state, ...opts });

export const ladderWilderness = (career, choice) =>
  post("/api/ladder/wilderness", { career, choice });
