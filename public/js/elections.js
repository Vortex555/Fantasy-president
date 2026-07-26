"use strict";

import { $, show, escapeHtml, loader, monthLabel } from "./util.js";
import { G, saveCareer } from "./store.js";
import { midtermBoard, finishMidterms, finishCampaign } from "./api.js";

/**
 * Election nights — both of them.
 *
 * The midterms and the general are the same screen wearing different hats: a
 * map, a war chest to spend on it, and then the count. They share this module
 * because they share the two things that matter — the tile cartogram the player
 * has been reading all term, and the allocator that turns money into margin.
 */

let handlers = {};
let plan = {};      // state code → $M committed
let board = null;   // what the server says is on the ballot

const CHUNK = 10;   // a click commits this much, in $M
const money = (n) => `$${Math.round(n)}M`;

// ---------------------------------------------------------------------------
// The shared spend allocator
// ---------------------------------------------------------------------------

const committed = () => Object.values(plan).reduce((a, b) => a + b, 0);
const remaining = (chest) => Math.max(0, chest - committed());

/**
 * The map, as a place to spend money. Tiles are shaded by how the state stands
 * today and badged with whatever has been committed there, so the decision is
 * made against the same picture the player has watched for four years.
 */
function spendMap(state, { senateStates = null } = {}) {
  const tiles = Object.entries(G.meta.states).map(([code, info]) => {
    const approval = state.stateApproval?.[code] ?? 50;
    const spent = plan[code] || 0;
    // A Senate race on the ballot is worth flagging; a state without one is not
    // off the table, but the money there is only buying House seats.
    const onBallot = !senateStates || senateStates.includes(code);
    return `<button class="map__tile map__tile--live${spent ? " is-funded" : ""}"
      data-spend="${code}" style="grid-column:${info.c + 1};grid-row:${info.r + 1};background:${tone(approval)}"
      title="${escapeHtml(info.name)} — ${Math.round(approval)}% approval, ${info.ev} EV${
        onBallot ? "" : " · no Senate race this cycle"}${spent ? ` · ${money(spent)} committed` : ""}">
      ${code}${spent ? `<i class="map__spend">${Math.round(spent)}</i>` : ""}</button>`;
  }).join("");

  return `<div class="map map--live">${tiles}</div>`;
}

function tone(v) {
  if (v >= 56) return "#2f9e6e";
  if (v >= 52) return "#5cae86";
  if (v > 48) return "#8b96a8";
  if (v > 44) return "#c47a70";
  return "#b0453f";
}

/** Repaint just the money, without rebuilding the map. */
function paintBudget(chest) {
  const left = remaining(chest);
  const bar = $("spendBar");
  if (bar) bar.style.width = `${Math.min(100, (committed() / Math.max(1, chest)) * 100)}%`;
  const label = $("spendLabel");
  if (label) {
    label.textContent = committed()
      ? `${money(committed())} committed · ${money(left)} left`
      : `${money(chest)} in the war chest — click a state to commit ${money(CHUNK)}`;
  }
  for (const tile of document.querySelectorAll("[data-spend]")) {
    const spent = plan[tile.dataset.spend] || 0;
    tile.classList.toggle("is-funded", spent > 0);
    const badge = tile.querySelector(".map__spend");
    if (spent > 0 && !badge) {
      tile.insertAdjacentHTML("beforeend", `<i class="map__spend">${Math.round(spent)}</i>`);
    } else if (spent > 0) {
      badge.textContent = Math.round(spent);
    } else if (badge) {
      badge.remove();
    }
  }
}

/** Click to commit, right-click to pull it back out. */
function wireSpend(chest) {
  const root = document.querySelector(".map--live");
  if (!root) return;
  const adjust = (code, delta) => {
    const now = plan[code] || 0;
    const next = Math.max(0, Math.min(now + delta, now + remaining(chest)));
    if (next <= 0) delete plan[code]; else plan[code] = next;
    paintBudget(chest);
  };
  root.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-spend]");
    if (tile) adjust(tile.dataset.spend, CHUNK);
  });
  root.addEventListener("contextmenu", (e) => {
    const tile = e.target.closest("[data-spend]");
    if (!tile) return;
    e.preventDefault();
    adjust(tile.dataset.spend, -CHUNK);
  });
  const clear = $("spendClear");
  if (clear) clear.onclick = () => { plan = {}; paintBudget(chest); };
  paintBudget(chest);
}

// ---------------------------------------------------------------------------
// The midterms
// ---------------------------------------------------------------------------

/** Month 24: the whole House and a third of the Senate, and you are not on it. */
export async function renderMidterms(hooks) {
  handlers = hooks;
  plan = {};
  const state = G.state;

  loader(true, "The campaigns are filing…");
  try {
    board = await midtermBoard(state);
  } catch (err) {
    alert("The midterm board could not be loaded: " + err.message);
    return handlers.onDashboard();
  } finally {
    loader(false);
  }

  const c = state.congress;
  const chest = board.warChest || 0;

  $("electionBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">The Midterms</h1>
        <div class="dash-head__sub">Every seat in the House and ${board.senateStates.length} in the
          Senate. Your name is not on the ballot; your record is.</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${escapeHtml(monthLabel(state.month, state.scenario.startYear))}</h2>
        <div class="dash-head__sub">Class ${board.cycle} of the Senate is up</div>
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">🏛️ What you are defending</span>
      <div class="tiles tiles--four" style="margin-top:12px">
        ${cell("House", `${c.houseD}D – ${c.houseR}R`)}
        ${cell("Senate", `${c.senateD}D – ${c.senateR}R`)}
        ${cell("Your approval", `${Math.round(state.approval)}%`)}
        ${cell("War chest", money(chest))}
      </div>
      <p class="hint" style="margin:14px 0 0">
        The party holding the White House almost always loses ground at a midterm. You are
        running to lose less. ${escapeHtml(board.challenger.name)} is already campaigning against
        ${escapeHtml(board.challenger.attack)}.
      </p>
    </div>

    <div class="card">
      <div class="card__head">
        <span class="eyebrow">💵 Where does the money go?</span>
        <button class="btn btn--sm" id="spendClear">Clear</button>
      </div>
      <p class="hint" style="margin:0 0 14px">
        Click a state to commit ${money(CHUNK)}; right-click to take it back. A million goes
        much further in Nevada than in California, and the returns flatten fast.
      </p>
      ${spendMap(state, { senateStates: board.senateStates })}
      <div class="spend">
        <div class="spend__track"><div class="spend__fill" id="spendBar"></div></div>
        <p class="hint center" id="spendLabel" style="margin:10px 0 0"></p>
      </div>
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="midtermGo" style="max-width:340px">
        Election Night →
      </button>
    </div>`;

  wireSpend(chest);
  $("midtermGo").onclick = () => holdMidterms();
  show("election");
  window.scrollTo(0, 0);
}

async function holdMidterms() {
  loader(true, "The polls are closing…");
  try {
    const data = await finishMidterms(G.state, plan);
    G.state = data.state;
    saveCareer();
    paintMidtermResult(data.result);
  } catch (err) {
    alert("The midterms could not be held: " + err.message);
  } finally {
    loader(false);
  }
}

function paintMidtermResult(result) {
  const state = G.state;
  const before = result.before;
  const after = result.congress;
  const party = state.scenario.party;

  const swingRow = (label, chamber, swing, was, now) => {
    const tone = swing > 0 ? "delta--up" : swing < 0 ? "delta--down" : "";
    return `<div class="result-row">
      <div><b>${label}</b><span class="result-row__sub">${was} → ${now}</span></div>
      <span class="delta ${tone}">${swing > 0 ? "+" : ""}${swing} seats</span>
    </div>`;
  };

  const flips = result.flips.slice(0, 14);
  const lost = result.flips.filter((f) => f.to !== mineParty(party)).length;
  const gained = result.flips.length - lost;

  $("electionBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">The Results</h1>
        <div class="dash-head__sub">${escapeHtml(result.note)}</div>
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">📊 The new Congress</span>
      <div style="margin-top:14px">
        ${swingRow("House of Representatives", "house", result.house.swing,
          `${before.houseD}D – ${before.houseR}R`, `${after.houseD}D – ${after.houseR}R`)}
        ${swingRow("United States Senate", "senate", result.senate.swing,
          `${before.senateD}D – ${before.senateR}R`, `${after.senateD}D – ${after.senateR}R`)}
      </div>
      <p class="hint" style="margin:14px 0 0">
        ${escapeHtml(controlLine(result.control, party))}
      </p>
    </div>

    ${result.flips.length ? `<div class="card">
      <span class="eyebrow">🔁 ${result.flips.length} seats changed hands</span>
      <p class="hint" style="margin:6px 0 12px">
        ${gained} gained, ${lost} lost. The closest of them, first — these are the races the
        national mood decided rather than the district.
      </p>
      <div class="flips">
        ${flips.map((f) => `<span class="flip flip--${f.to === mineParty(party) ? "gain" : "loss"}">
          ${escapeHtml(f.seat)}<i>${f.margin.toFixed(1)}</i></span>`).join("")}
      </div>
    </div>` : ""}

    <div class="card">
      <span class="eyebrow">🗺️ The environment</span>
      <p style="margin:8px 0 0">
        The national environment ran <b>${result.env > 0 ? "+" : ""}${result.env} points</b>
        ${result.env >= 0 ? "in your favour" : "against you"}. Every race in the country moved
        by that much at once, which is why seats you never visited changed hands.
      </p>
      ${result.spend && Object.keys(result.spend).length ? `<p class="hint" style="margin:12px 0 0">
        You committed ${money(Object.values(result.spend).reduce((a, b) => a + b, 0))} across
        ${Object.keys(result.spend).length} states.</p>` : ""}
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="midtermDone" style="max-width:340px">
        Back to the West Wing →
      </button>
    </div>`;

  $("midtermDone").onclick = () => handlers.onDashboard();
  window.scrollTo(0, 0);
}

/**
 * Which caucus the president's seats are counted in. This has to agree with
 * `alignedParty` on the server, including the awkward case: an independent has
 * no party, and is bookkept on the Republican side because `congress` only has
 * two columns.
 */
const mineParty = (party) => (party === "Democrat" ? "Democrat" : "Republican");

function controlLine(control, party) {
  const mine = mineParty(party);
  const both = control.house === mine && control.senate === mine;
  const neither = control.house !== mine && control.senate !== mine;
  if (both) return "You keep both chambers. The agenda survives.";
  if (neither) return "You lost both chambers. From here on, nothing passes that they do not want.";
  const held = control.house === mine ? "House" : "Senate";
  const gone = control.house === mine ? "Senate" : "House";
  return `You hold the ${held} and lost the ${gone}. Every bill now needs a deal.`;
}

const cell = (label, value) => `<div class="tile tile--compact">
  <div class="tile__label">${escapeHtml(label)}</div>
  <div class="tile__value">${escapeHtml(String(value))}</div>
</div>`;

// ---------------------------------------------------------------------------
// Election night
// ---------------------------------------------------------------------------

/** The map allocator, shown once at the start of campaign season. */
export function renderCampaignSpend(hooks, onDone) {
  handlers = hooks;
  plan = {};
  const state = G.state;
  const chest = state.warChest || 0;
  const opponent = state.campaign.opponent;

  $("electionBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">The Ground Game</h1>
        <div class="dash-head__sub">Four years of fundraising, and one map to spend it on.</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${money(chest)}</h2>
        <div class="dash-head__sub">vs ${escapeHtml(opponent.name)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card__head">
        <span class="eyebrow">💵 Commit the war chest</span>
        <button class="btn btn--sm" id="spendClear">Clear</button>
      </div>
      <p class="hint" style="margin:0 0 14px">
        Click to commit ${money(CHUNK)}, right-click to pull it back. Spend where it is close —
        a state you are winning by twenty does not need the money, and a state you are losing by
        twenty cannot be bought.
      </p>
      ${spendMap(state)}
      <div class="spend">
        <div class="spend__track"><div class="spend__fill" id="spendBar"></div></div>
        <p class="hint center" id="spendLabel" style="margin:10px 0 0"></p>
      </div>
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="toDebate" style="max-width:340px">
        To the Debate Stage →
      </button>
    </div>`;

  wireSpend(chest);
  $("toDebate").onclick = () => onDone({ ...plan });
  show("election");
  window.scrollTo(0, 0);
}

/** The count. Fifty-one calls, an electoral college and a popular vote. */
export async function resolveElection(hooks, debateScore, spend) {
  handlers = hooks;
  loader(true, "The polls are closing. The nation votes…");
  try {
    const data = await finishCampaign(G.state, debateScore, spend || {});
    G.state = data.state;
    saveCareer();
    paintElectionNight(data.election || G.state.election, debateScore);
  } catch (err) {
    alert("The election could not be resolved: " + err.message);
    handlers.onLegacy();
  } finally {
    loader(false);
  }
}

function paintElectionNight(result, debateScore) {
  const state = G.state;
  // A win rolls into the next term, so `ending` is gone by now; the result
  // itself is the only reliable record of what happened tonight.
  if (!result) return handlers.onLegacy();

  const you = state.scenario.presidentName;
  const them = result.challenger?.name || "the challenger";
  const pctYou = (result.ev.you / 538) * 100;

  const tiles = result.states.map((s) => {
    const info = G.meta.states[s.code];
    const fill = s.tooClose ? "#8b96a8" : s.won ? "#2f9e6e" : "#b0453f";
    return `<span class="map__tile" style="grid-column:${info.c + 1};grid-row:${info.r + 1};background:${fill}"
      title="${escapeHtml(s.name)} — ${s.won ? "you" : escapeHtml(them)} by ${Math.abs(s.margin).toFixed(1)}, ${s.ev} EV">${s.code}</span>`;
  }).join("");

  $("electionBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${result.won ? "You Won" : "The Count"}</h1>
        <div class="dash-head__sub">${escapeHtml(
          result.split
            ? "The electoral college and the popular vote disagreed."
            : result.won ? "Four more years." : `${them} takes the presidency.`)}</div>
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">🗳️ The electoral college — 270 to win</span>
      <div class="evbar" style="margin-top:14px">
        <div class="evbar__you" style="width:${pctYou}%"></div>
        <div class="evbar__mark"></div>
      </div>
      <div class="evbar__legend">
        <span><b>${result.ev.you}</b> ${escapeHtml(you)}</span>
        <span><b>${result.ev.them}</b> ${escapeHtml(them)}</span>
      </div>

      <div class="tiles tiles--four" style="margin-top:20px">
        ${cell("Popular vote", `${result.popular.you.toFixed(1)}%`)}
        ${cell("Their share", `${result.popular.them.toFixed(1)}%`)}
        ${cell("Electoral votes", `${result.ev.you} / 538`)}
        ${cell("Too close to call", result.tooClose.length)}
      </div>
      ${result.split ? `<p class="hint" style="margin:14px 0 0">
        <b>A split decision.</b> ${result.won
          ? `You lost the popular vote by ${(result.popular.them - result.popular.you).toFixed(1)} points and won anyway.`
          : `You won the popular vote by ${(result.popular.you - result.popular.them).toFixed(1)} points and lost anyway.`}
      </p>` : ""}
    </div>

    <div class="card">
      <div class="card__head">
        <span class="eyebrow">🗺️ The map</span>
        <span class="map__legend"><i style="background:#2f9e6e"></i>you<i style="background:#8b96a8"></i>too close<i style="background:#b0453f"></i>${escapeHtml(them)}</span>
      </div>
      <div class="map">${tiles}</div>
    </div>

    <div class="card">
      <span class="eyebrow">📍 The states that decided it</span>
      <div class="flips" style="margin-top:12px">
        ${result.decisive.map((s) => `<span class="flip flip--${s.won ? "gain" : "loss"}">
          ${s.code}<i>${s.margin > 0 ? "+" : ""}${s.margin.toFixed(1)}</i></span>`).join("")}
      </div>
      <p class="hint" style="margin:14px 0 0">
        The debate was worth ${result.debate > 0 ? "+" : ""}${result.debate} points in every state.
        ${Object.keys(result.spend || {}).length
          ? `Your ${money(Object.values(result.spend).reduce((a, b) => a + b, 0))} went to
             ${Object.keys(result.spend).length} of them.`
          : "You spent nothing, and it showed where it was close."}
      </p>
    </div>

    ${!state.over && state.cabinetChanges?.length ? `<div class="card">
      <span class="eyebrow">🧳 The second-term cabinet</span>
      <p style="margin:10px 0 0">
        <b>${state.cabinetChanges.length}</b> of your cabinet went home rather than serve another
        four years. Their replacements are loyal, and green — second terms are staffed by people
        who were not there for the first one.
      </p>
    </div>` : ""}

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="electionDone" style="max-width:340px">
        ${state.over ? "The Historical Record →" : "Take the Oath Again →"}
      </button>
    </div>`;

  $("electionDone").onclick = () => {
    if (state.over) return handlers.onLegacy();
    G.event = null;
    handlers.onDashboard();
  };
  // The debate runs on its own screen, so the results have to claim this one
  // back — without this the count is rendered into a hidden element and the
  // player is left staring at the podium.
  show("election");
  window.scrollTo(0, 0);
}
