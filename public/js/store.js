"use strict";

/**
 * In-memory game state plus the two things that outlive a page load:
 * saved careers (a whole game you can resume) and saved presidents
 * (a character sheet you can reuse across careers).
 */

const CAREERS_KEY = "fp.careers.v1";
const PRESIDENTS_KEY = "fp.presidents.v1";

/**
 * How long a term runs in each office. The careers list dates a save from this,
 * and hardcoding forty-eight months put every House career six years into the
 * future — and another two years further with every term served.
 */
export const TERM_MONTHS = { president: 48, house: 24, senate: 72 };

export const termLengthOf = (state) => TERM_MONTHS[state?.office] || TERM_MONTHS.president;

export const G = {
  meta: null,
  careerId: null,
  state: null,
  event: null,        // the situation awaiting a decision
  pendingEvent: null, // next month's situation, revealed on continue
  draft: null,        // character sheet being built in setup
  chats: {},          // advisor id -> message history
  currentAdvisor: null,
  debate: null,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded or storage disabled — the game still plays, it just
    // won't survive a reload. Say so rather than failing silently.
    console.warn("Could not save to local storage; this career won't persist.");
    return false;
  }
}

// --- Careers ---------------------------------------------------------------

export const listCareers = () => read(CAREERS_KEY, []);

export function saveCareer() {
  if (!G.state || !G.careerId) return;
  const careers = listCareers().filter((c) => c.id !== G.careerId);
  const s = G.state;
  careers.unshift({
    id: G.careerId,
    name: s.scenario.presidentName,
    party: s.scenario.party,
    scenarioName: s.scenario.scenarioName || "Custom",
    startYear: s.scenario.startYear || 2025,
    // Absolute, so the career list shows the right calendar date in term two.
    month: ((s.term || 1) - 1) * termLengthOf(s) + s.month,
    office: s.office || "president",
    seat: s.seat ? { district: s.seat.district, state: s.seat.state, stateName: s.seat.stateName } : null,
    rank: s.rank || null,
    term: s.term || 1,
    over: Boolean(s.over),
    lastPlayed: new Date().toISOString(),
    state: s,
    event: G.event,
    pendingEvent: G.pendingEvent,
  });
  write(CAREERS_KEY, careers.slice(0, 12));
}

export function deleteCareer(id) {
  write(CAREERS_KEY, listCareers().filter((c) => c.id !== id));
}

export function loadCareer(id) {
  const career = listCareers().find((c) => c.id === id);
  if (!career) return null;
  G.careerId = career.id;
  G.state = career.state;
  G.event = career.event || null;
  G.pendingEvent = career.pendingEvent || null;
  G.chats = {};
  return career;
}

export function newCareerId() {
  G.careerId = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return G.careerId;
}

// --- Saved presidents ------------------------------------------------------

export const listPresidents = () => read(PRESIDENTS_KEY, []);

export function savePresident(draft) {
  const name = (draft.presidentName || "").trim();
  if (!name) return false;
  const saved = listPresidents().filter((p) => p.presidentName !== name);
  saved.unshift({ ...draft, savedAt: new Date().toISOString() });
  return write(PRESIDENTS_KEY, saved.slice(0, 20));
}

export function deletePresident(name) {
  write(PRESIDENTS_KEY, listPresidents().filter((p) => p.presidentName !== name));
}
