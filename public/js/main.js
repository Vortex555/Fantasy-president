"use strict";

import { loader } from "./util.js";
import { G, newCareerId, saveCareer } from "./store.js";
import { getMeta, startGame, resignOffice } from "./api.js";
import { renderCareers, renderModeBadge } from "./careers.js";
import { renderScenarios, renderEras } from "./scenario.js";
import { renderCharacter } from "./character.js";
import { renderNextChoice } from "./ladder/next.js";
import { renderLadderRace } from "./ladder/race.js";
import { renderWilderness } from "./ladder/wilderness.js";
import { renderBio } from "./bio.js";
import { renderRunningMate } from "./runningmate.js";
import { renderCabinet } from "./cabinet.js";
import { renderDashboardAsync } from "./dashboard.js";
import { cabinetDoctrines } from "./api.js";
import { renderBriefing, endTheMonth } from "./turn.js";
import { renderCampaign } from "./campaign.js";
import { renderMidterms } from "./elections.js";
import { renderTwentyFifth, renderOath } from "./succession.js";
import { renderPrimary } from "./primary.js";
import { renderOffice, renderDistricts, renderStates, renderStateSeats } from "./house/setup.js";
import { renderFloor } from "./house/floor.js";
import { renderStateFloor } from "./house/statefloor.js";
import { renderCountry } from "./house/country.js";
import { renderHouseElection } from "./house/election.js";
import { renderHouseLegacy } from "./house/legacy.js";
import { renderLegacy } from "./legacy.js";
import { wireDrawer, closeDrawer } from "./drawer.js";

const QUIET_MONTH = {
  title: "A Quiet Month",
  brief: "No single crisis dominates the news, which gives you rare room to set your own agenda. What will you push?",
};

let pending = { scenario: null, era: null, draft: null };

// --- Navigation ------------------------------------------------------------

const goCareers = () => renderCareers(goDashboard, goScenarios);
const goScenarios = () => renderScenarios(onEraChosen);
/**
 * The home screen of a career, whichever office it is for. Resuming a saved
 * House career must never land on the presidential dashboard — it has no
 * cabinet, no stakeholders and no map to draw.
 *
 * One list rather than four. Adding the state legislature meant adding an
 * office to three separate `["house", "senate"]` literals scattered through
 * this file, and the one that was missed sent a newly sworn-in state
 * representative to the presidential dashboard — which reads a cabinet and an
 * economy they do not have, inside an async call nobody awaited, so the failure
 * was a screen that simply stopped with no error anywhere. Every office that is
 * not the presidency belongs here.
 */
const LEGISLATURES = ["house", "senate", "statehouse"];
const inLegislature = (state = G.state) => LEGISLATURES.includes(state?.office);

const goDashboard = (delta = null) => (inLegislature()
  ? goPlay()
  : renderDashboardAsync(dashHandlers, delta));
const goLegacy = () => (inLegislature()
  ? renderHouseLegacy(goCareers)
  : renderLegacy(goCareers));
const electionHooks = { onLegacy: () => goLegacy(), onDashboard: () => goDashboard(null) };
const goCampaign = () => renderCampaign(electionHooks);
const goMidterms = () => renderMidterms(electionHooks);
const goTwentyFifth = () => renderTwentyFifth(electionHooks);
const goPrimary = () => renderPrimary(electionHooks);
const goOath = (formerName) => renderOath(electionHooks, null, formerName);

const houseHooks = {
  onDashboard: () => goPlay(),
  onFloor: () => renderFloor(houseHooks),
  // What the career has done to the country, month by month.
  onCountry: () => renderCountry(houseHooks),
  onElection: (result, ladder, cycle, choices) =>
    renderHouseElection(houseHooks, result, ladder, cycle, choices),
  // A member's career closes on the House's own record, not the presidency's.
  onLegacy: () => renderHouseLegacy(goCareers),
  // A term ending is where a career decides whether to stay where it is.
  onNext: () => renderNextChoice(ladderHooks),
};

/**
 * The ladder.
 *
 * Three screens and one rule: reaching is never blocked, only priced. A win
 * builds the next office from the career that reached it; a loss either drops
 * you back into the seat you kept, or — if you gave it up to run — into the
 * wilderness, which is a chapter rather than an ending.
 */
const ladderHooks = {
  onFloor: () => renderFloor(houseHooks),
  onLegacy: () => goLegacy(),
  onBack: () => renderNextChoice(ladderHooks),

  onChoice: (choice) => {
    if (choice.id === "retire") return goLegacy();
    if (choice.id === "re-elect") return renderFloor(houseHooks);
    renderLadderRace(ladderHooks, choice);
  },

  onResult: async (result, choice) => {
    if (result.won) return takeNewOffice(choice);
    // Beaten. Whether that is a setback or an unemployment depends entirely on
    // whether the ballots collided — which the player was told before running.
    if (!choice.collides) return renderFloor(houseHooks);
    G.career = { ...G.career, status: "wilderness",
      wilderness: { lostTo: result.opponent?.name || "the other candidate",
        office: choice.office, since: G.career.year } };
    saveCareer();
    renderWilderness(ladderHooks);
  },
};

/** Won it. Build the office from the career that reached it, and swear in. */
async function takeNewOffice(choice) {
  loader(true, "Swearing you in…");
  try {
    const data = await startGame({
      ...G.state.scenario,
      office: choice.office,
      seatState: choice.where || G.state.seat?.state,
    }, G.career);
    G.state = data.state;
    G.career = data.career || G.career;
    G.event = data.event;
    G.pendingEvent = null;
    G.chats = {};
    saveCareer();
    goPlay();
  } catch (err) {
    alert("The oath could not be administered: " + err.message);
  } finally {
    loader(false);
  }
}

/** Entering the month. A resumed career may belong somewhere else entirely. */
function goPlay() {
  closeDrawer();
  if (G.state.over) return goLegacy();
  // The bottom rung has its own screen: almost nothing on the congressional
  // floor exists in a state legislature. See statefloor.js.
  if (G.state.office === "statehouse") return renderStateFloor(houseHooks);
  // A member of the House plays a completely different month.
  if (G.state.office === "house" || G.state.office === "senate") return renderFloor(houseHooks);
  if (G.state.phase === "campaign") return goCampaign();
  // Month 24 is not a month you play through — it is a night you survive.
  if (G.state.phase === "midterms") return goMidterms();
  // Your own party decides before the country does.
  if (G.state.phase === "primary") return goPrimary();
  // Your own cabinet has moved against you. Nothing else happens until you answer.
  if (G.state.phase === "twentyfifth") return goTwentyFifth();
  if (!G.event) G.event = QUIET_MONTH;
  renderBriefing(turnHooks);
}

const dashHandlers = {
  onCareers: () => { saveCareer(); goCareers(); },
  /**
   * The button on the dashboard used to open the one screen a month contained.
   * The month is now a schedule the player works through in any order they
   * like, so this ends it — carrying whatever was written in the Situation
   * Room, or nothing at all. The special phases still have screens of their
   * own and `goPlay` still routes to them.
   */
  onPlay: () => {
    const phase = G.state?.phase;
    if (G.state?.office === "house" || G.state?.office === "senate"
        || phase === "campaign" || phase === "midterms" || phase === "primary"
        || phase === "twentyfifth" || G.state?.over) {
      return goPlay();
    }
    return endTheMonth(String(G.state?.policy || ""), "");
  },
  onLegacy: goLegacy,
  onResign: resign,
};

const turnHooks = {
  onDashboard: () => goDashboard(null),
  onCampaign: goCampaign,
  onMidterms: goMidterms,
  onPrimary: goPrimary,
  onTwentyFifth: goTwentyFifth,
  onOath: goOath,
  onLegacy: goLegacy,
};

// --- Setup flow ------------------------------------------------------------

function onEraChosen(scenario, era) {
  pending = { scenario, era, draft: null, office: "president" };
  renderOffice(onOfficeChosen, () => (scenario.eras?.length ? renderEras(onEraChosen) : goScenarios()));
}

function onOfficeChosen(office) {
  pending.office = office;
  const back = () => renderOffice(onOfficeChosen, goScenarios);
  // The character screen is the same screen for all three offices, but almost
  // nothing on it means the same thing, so it is told which one it is drawing.
  renderCharacter(pending.scenario, pending.era, office, onCharacterReady, back);
}

function onCharacterReady(draft) {
  pending.draft = { ...draft, office: pending.office };
  const afterBio = (d) => {
    pending.draft = d;
    // A legislator has no running mate; they have a seat.
    if (pending.office === "house") {
      return renderDistricts(d, onDistrictChosen, () => onOfficeChosen(pending.office));
    }
    if (pending.office === "senate") {
      return renderStates(d, onStateChosen, () => onOfficeChosen(pending.office));
    }
    // A state seat needs both: which state, and then which district inside it.
    if (pending.office === "statehouse") {
      return renderStates(d, (code) => renderStateSeats(
        { ...d, seatState: code },
        (seatId) => launch({ ...d, office: "statehouse", seatState: code, district: seatId }),
        () => renderStates(d, () => {}, () => onOfficeChosen(pending.office)),
      ), () => onOfficeChosen(pending.office));
    }
    renderRunningMate(d, onRunningMateReady);
  };
  if (draft.bio) {
    return renderBio(draft, (bioAnswers) => afterBio({ ...pending.draft, bioAnswers }),
      () => onOfficeChosen(pending.office));
  }
  afterBio(pending.draft);
}

async function onDistrictChosen(district) {
  await launch({ ...pending.draft, office: "house", district });
}

async function onStateChosen(seatState) {
  await launch({ ...pending.draft, office: "senate", seatState });
}

/**
 * The running mate is chosen, and then the rest of the government is.
 *
 * A president used to be sworn in with eleven strangers already at the table.
 * They are now a decision, because the rooms ask those people for plans and a
 * plan is only as good as whoever you appointed. A transition that cannot reach
 * the server for its slates is not a reason to block an inauguration, so a
 * failure here goes straight to the oath with the old random cabinet.
 */
async function onRunningMateReady(vp) {
  const draft = { ...pending.draft, vp };
  try {
    const { doctrines, posts } = await cabinetDoctrines();
    if (!doctrines?.length) return launch(draft);
    return renderCabinet(draft, (cabinet) => launch({ ...draft, ...cabinet }), doctrines, posts);
  } catch {
    return launch(draft);
  }
}

/** Start whatever career was just built, and go wherever it belongs. */
async function launch(scenario) {
  loader(true, scenario.office === "house" ? "Swearing you in…" : "Preparing the inauguration…");
  try {
    const data = await startGame(scenario);
    G.state = data.state;
    G.career = data.career || null;
    G.event = data.event;
    G.pendingEvent = null;
    G.chats = {};
    newCareerId();
    saveCareer();
    // Anything that is not the presidency plays its own chamber's screen.
    if (inLegislature()) return goPlay();
    goDashboard(null);
  } catch (err) {
    alert("Could not start the game: " + err.message);
  } finally {
    loader(false);
  }
}

/**
 * Resignation runs through the engine rather than the client, because the oath
 * passes to the Vice President and the career continues under them — which the
 * client has no way to work out on its own.
 */
async function resign() {
  const vp = (G.state.cabinet || []).find((c) => c.id === "vp");
  const warning = vp
    ? `Resign the presidency? ${vp.name} is sworn in immediately and you play on as them — ` +
      `the economy, Congress and everything still unfinished carry over.`
    : "Resign the presidency? There is no Vice President to take the oath, so the record closes here.";
  if (!confirm(warning)) return;

  const former = G.state.scenario.presidentName;
  loader(true, "The letter has been delivered…");
  try {
    const data = await resignOffice(G.state);
    G.state = data.state;
    saveCareer();
    if (data.succeeded) return goOath(former);
    goLegacy();
  } catch (err) {
    alert("The resignation could not be filed: " + err.message);
  } finally {
    loader(false);
  }
}

// --- Boot ------------------------------------------------------------------

async function init() {
  G.meta = await getMeta();
  // What the last real call found out, so a reload does not reset the badge to
  // whatever the server believed when it booted.
  G.ai = G.meta?.aiHealth || null;
  renderModeBadge();
  wireDrawer();

  // Static back buttons declared in the markup.
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (!nav) return;
    if (nav.dataset.nav === "careers") goCareers();
    if (nav.dataset.nav === "scenarios") goScenarios();
  });

  goCareers();
}

init();
