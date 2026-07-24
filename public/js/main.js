"use strict";

import { loader } from "./util.js";
import { G, newCareerId, saveCareer } from "./store.js";
import { getMeta, startGame } from "./api.js";
import { renderCareers, renderModeBadge } from "./careers.js";
import { renderScenarios, renderEras } from "./scenario.js";
import { renderCharacter } from "./character.js";
import { renderBio } from "./bio.js";
import { renderRunningMate } from "./runningmate.js";
import { renderDashboardAsync } from "./dashboard.js";
import { renderBriefing } from "./turn.js";
import { renderCampaign } from "./campaign.js";
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
const goDashboard = (delta = null) => renderDashboardAsync(dashHandlers, delta);
const goLegacy = () => renderLegacy(goCareers);
const goCampaign = () => renderCampaign({ onLegacy: goLegacy });

/** Entering the month. A resumed career may belong somewhere else entirely. */
function goPlay() {
  closeDrawer();
  if (G.state.over) return goLegacy();
  if (G.state.phase === "campaign") return goCampaign();
  if (!G.event) G.event = QUIET_MONTH;
  renderBriefing(turnHooks);
}

const dashHandlers = {
  onCareers: () => { saveCareer(); goCareers(); },
  onPlay: goPlay,
  onLegacy: goLegacy,
  onResign: resign,
};

const turnHooks = {
  onDashboard: () => goDashboard(null),
  onCampaign: goCampaign,
  onLegacy: goLegacy,
};

// --- Setup flow ------------------------------------------------------------

function onEraChosen(scenario, era) {
  pending = { scenario, era, draft: null };
  const back = () => (scenario.eras?.length ? renderEras(onEraChosen) : goScenarios());
  renderCharacter(scenario, era, onCharacterReady, back);
}

function onCharacterReady(draft) {
  pending.draft = draft;
  // The guided bio only appears when the player asked for it.
  if (draft.bio) {
    return renderBio(draft, (bioAnswers) => {
      pending.draft = { ...draft, bioAnswers };
      renderRunningMate(pending.draft, onRunningMateReady);
    }, () => onEraChosen(pending.scenario, pending.era));
  }
  renderRunningMate(draft, onRunningMateReady);
}

async function onRunningMateReady(vp) {
  const d = pending.draft;
  loader(true, "Preparing the inauguration…");
  try {
    const data = await startGame({ ...d, vp });
    G.state = data.state;
    G.event = data.event;
    G.pendingEvent = null;
    G.chats = {};
    newCareerId();
    saveCareer();
    goDashboard(null);
  } catch (err) {
    alert("Could not start the game: " + err.message);
  } finally {
    loader(false);
  }
}

function resign() {
  if (!confirm("Resign the presidency? Your term ends here and the record closes as it stands.")) return;
  G.state = {
    ...G.state,
    over: true,
    phase: "concluded",
    ending: {
      type: "resigned",
      reason: "You resigned the presidency. The oath passes to your Vice President, and the country is left to argue about why.",
    },
  };
  saveCareer();
  goLegacy();
}

// --- Boot ------------------------------------------------------------------

async function init() {
  G.meta = await getMeta();
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
