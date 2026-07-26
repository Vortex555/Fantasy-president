"use strict";

import { $, el, show, escapeHtml, monthLabel, shortMonthLabel, track, toneFor, netApproval,
  absoluteMonth, ordinalTerm } from "./util.js";
import { G, saveCareer } from "./store.js";
import { PORTFOLIOS } from "./data/catalog.js";
import { partyStanding as partySupport } from "./data/party.js";
import { openDrawer } from "./drawer.js";
import { institutionsCard, wireInstitutions } from "./cards/institutions.js";
import { firstLadyCard, wireFirstLady } from "./cards/firstLady.js";
import { specialActionsCard, wireSpecialActions, loadActions } from "./cards/specialActions.js";
import { approvalChart } from "./cards/chart.js";
import { foreignCard, societyCard, warCard, covertCard } from "./cards/world.js";
import { chamberRow, courtCard } from "./cards/legislature.js";
import { billsCard, wireBills } from "./cards/bills.js";
import { jeopardyCard } from "./cards/jeopardy.js";
import { governorsCard, wireGovernors } from "./cards/governors.js";

const TERM = 48;

const DOMAIN_LABEL = {
  economy: "Economy", security: "National Security", justice: "Law & Justice",
  social: "Society", foreign: "Foreign Affairs", health: "Health & Environment",
};

export const liveArcs = (state) => (state.arcs || [])
  .filter((a) => a.status === "active" || a.status === "detonated")
  .sort((a, b) => b.severity - a.severity);

export const scarArcs = (state) => (state.arcs || []).filter((a) => a.status === "scarred");

/** Electoral votes in states where the president is currently above water. */
export function favorableEV(state) {
  let ev = 0;
  for (const [code, info] of Object.entries(G.meta.states)) {
    if ((state.stateApproval[code] ?? 50) >= 52) ev += info.ev;
  }
  return ev;
}

/**
 * How the president's own coalition is holding.
 *
 * Re-exported from the engine rather than derived here: this number now decides
 * whether the party comes for you at the primary, so there must be exactly one
 * of it. See primary.js.
 */
export { partyStanding as partySupport } from "./data/party.js";

function timelineCopy(state) {
  const monthsLeft = TERM - state.month + 1;
  const term = ordinalTerm(state.term || 1);
  // Two terms is the limit until the 22nd Amendment is repealed.
  const canRunAgain = state.specialActions?.termLimitGone || (state.term || 1) < 2;
  // With the Capitol padlocked there are no elections to count down to. The
  // only clock left is how long the Pentagon keeps carrying the government.
  if (state.congressDissolved) {
    const army = state.stakeholders?.pentagon ?? 0;
    return [
      `Rule by decree · ${monthsLeft} months of the original term left`,
      army < 62
        ? `The Pentagon is at ${army}. Below 55 the generals stop taking your calls, and there is no lawful way left to protect you.`
        : `No election is scheduled. The army is at ${army}, and it is the only thing holding this government up.`,
    ];
  }
  if (state.phase === "campaign") return ["Election season", "The country is deciding whether to keep you."];
  if (state.phase === "midterms") {
    return ["The midterms", "Every seat in the House and a third of the Senate. Your name is not on the ballot; your record is."];
  }
  if (state.month <= 6) {
    return [`${term} Term · ${24 - state.month} months until the mid-term election`,
      (state.term || 1) > 1
        ? "A second honeymoon is shorter than the first. Spend it on the thing you could not get done last time."
        : "The honeymoon period. Use it wisely."];
  }
  if (state.month <= 22) return [`${term} Term · ${Math.max(0, 24 - state.month)} months until the mid-term election`, "The window for hard votes is closing."];
  if (state.month <= 44) return [`${term} Term · ${monthsLeft} months left in the term`, "Governing season. The record you run on is being written now."];
  return [`${term} Term · ${monthsLeft} months left`,
    canRunAgain
      ? "The campaign is already underway in everything but name."
      : "You cannot run again. Every ally in this town knows it, and is already looking past you."];
}

/**
 * The war chest. It accrues quietly every month from approval and the blocs,
 * and is only ever spent on a map — at the midterms and on election night — so
 * the tile has to say what it is *for*, not just how much of it there is.
 */
function warChestTile(state) {
  const money = Math.round(state.warChest ?? 0);
  const next = (state.month <= 24 && state.midtermTerm !== (state.term || 1))
    ? "the midterms" : "election night";
  // A full bar is a war chest that can genuinely contest a national map.
  const FULL = 300;
  const sub = money >= 150 ? `Enough to contest a real map at ${next}`
    : money >= 60 ? `Buys a few states at ${next}`
    : "Thin — popularity and warm blocs are what raise money";

  return `<div class="tile">
    <span class="eyebrow">War chest</span>
    <div class="tile__value">$${money}M</div>
    <div class="tile__delta">Raised every month</div>
    <div class="tile__sub">${escapeHtml(sub)}</div>
    ${track(Math.min(100, (money / FULL) * 100), toneFor(Math.min(100, (money / FULL) * 100)))}
  </div>`;
}

export function renderDashboard(handlers, delta) {
  const state = G.state;
  const s = state.scenario;
  const startYear = s.startYear || 2025;
  const [timelineTitle, timelineNote] = timelineCopy(state);
  const approval = Math.round(state.approval);
  const stability = Math.round(state.stability);
  const party = partySupport(state);
  const partyLabel = s.party === "Independent" ? "Coalition" : `${s.party} party`;

  const deltaHtml = (d) => (d != null && Math.abs(d) >= 0.1)
    ? `<span class="delta delta--${d > 0 ? "up" : "down"}">${d > 0 ? "▲ +" : "▼ "}${d.toFixed(1)}</span>`
    : "Net — 0";

  $("dashBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${escapeHtml(s.presidentName)}</h1>
        <div class="dash-head__sub">President · ${escapeHtml(s.party)}${s.ideology ? ` · ${escapeHtml(s.ideology)}` : ""}${s.style ? ` · ${escapeHtml(s.style)}` : ""}</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${monthLabel(absoluteMonth(state), startYear)}</h2>
        <div class="dash-head__sub">${escapeHtml(s.scenarioName || "Political Career")}${
          (state.term || 1) > 1 ? ` · ${ordinalTerm(state.term)} term` : ""}</div>
      </div>
    </div>

    <div class="card card--accent">
      <span class="eyebrow">Election timeline</span>
      <div class="card__head" style="margin:6px 0 0"><strong style="font-size:16px;color:var(--ink)">${escapeHtml(timelineTitle)}</strong></div>
      <p class="hint" style="margin:2px 0 0">${escapeHtml(timelineNote)}</p>
    </div>

    <div class="card card--accent">
      <h3 class="display display--sm">This Month</h3>
      <p class="hint" style="margin:6px 0 14px">${state.over
        ? "This career is over. Look back at the record, or start another."
        : "A new situation is waiting for your response."}</p>
      <div class="btn-row">
        <button class="btn" id="toCareers">← Back to Careers</button>
        ${state.over ? "" : `<button class="btn btn--danger" id="resignBtn">Resign as President</button>`}
        ${state.over
          ? `<button class="btn btn--primary" id="legacyBtn">See Your Legacy →</button>`
          : `<button class="btn btn--blue" id="playBtn">Play ${shortMonthLabel(absoluteMonth(state), startYear)} →</button>`}
      </div>
    </div>

    <div class="tiles tiles--four">
      ${tile("Net approval", netApproval(state.approval), deltaHtml(delta),
        `${approval}% approve · voter mood`, toneFor(approval), { signed: true })}
      ${tile("Government stability", stability, "Net — 0", "Cabinet & agency support", toneFor(stability))}
      ${tile(`${partyLabel} stability`, party, "Net — 0", "Internal party support", toneFor(party))}
      ${warChestTile(state)}
    </div>

    ${primaryWarning(state)}
    ${congressCard(state)}
    ${billsCard(state)}
    ${jeopardyCard(state)}
    ${deskCard(state)}
    ${courtCard(state)}
    ${vpCard(state)}
    ${firstLadyCard(state)}
    ${cabinetCard(state)}
    ${institutionsCard(state)}
    ${specialActionsCard(state)}

    <div class="grid-2" style="margin-top:14px">
      ${timelineCard(state, startYear)}
      ${stakeholderCard(state)}
    </div>

    ${approvalChart(state)}
    ${economyCard(state)}
    ${societyCard(state)}
    ${warCard(state)}
    ${covertCard(state)}

    <div class="grid-2" style="margin-top:14px">
      ${foreignCard(state)}
      ${mapCard(state, { flush: true })}
      ${governorsCard(state)}
    </div>`;

  wire(handlers);
  show("dash");
}

/**
 * The dashboard is a pure render, so anything that needs a round-trip to the
 * server (the special-actions docket and its odds) is fetched first and then
 * the board is repainted.
 */
export async function renderDashboardAsync(handlers, delta) {
  renderDashboard(handlers, delta);
  if (G.state && !G.state.over) {
    await loadActions(G.state);
    renderDashboard(handlers, delta);
    // The statehouses fetch their own roster and re-paint in place, so a slow
    // call never holds up the rest of the dashboard.
    wireGovernors(() => renderDashboardAsync(handlers, delta));
  }
}

/**
 * A stat tile. `signed` renders a net figure (which can be negative) and fills
 * the bar from the midpoint, so the meter reads the same way the number does.
 */
function tile(label, value, deltaHtml, sub, tone, { signed = false } = {}) {
  const shown = signed ? `${value > 0 ? "+" : ""}${value}%` : `${value}%`;
  return `<div class="tile">
    <span class="eyebrow">${escapeHtml(label)}</span>
    <div class="tile__value">${shown}</div>
    <div class="tile__delta">${deltaHtml}</div>
    <div class="tile__sub">${escapeHtml(sub)}</div>
    ${signed ? netTrack(value, tone) : track(value, tone)}
  </div>`;
}

/** A meter that grows left or right of centre for a net figure. */
function netTrack(net, tone) {
  const half = Math.min(50, Math.abs(net)) / 2; // percent of the full width
  const left = net >= 0 ? 50 : 50 - half;
  return `<div class="track track--net">
    <i style="margin-left:${left}%;width:${half}%;background:${tone}"></i>
  </div>`;
}

function congressCard(state) {
  const { houseD, houseR, senateD, senateR } = state.congress;

  // There is nothing to draw when the Capitol is padlocked.
  if (state.congressDissolved) {
    return `<div class="card card--accent" style="margin-top:14px;border-left-color:var(--red)">
      <div class="card__head">
        <span class="eyebrow">🏛️ Congress</span>
        <span class="badge badge--red">Dissolved</span>
      </div>
      <p class="analysis" style="margin:0">There is no Congress. Your decrees take effect the moment you sign
        them, and the only thing holding this government up is the army.</p>
    </div>`;
  }
  const chamber = (name, d, r, total) => {
    // A tied chamber is not a majority for anybody; in the Senate the VP
    // breaks it, which is the whole reason the running mate mattered.
    const tied = d === r;
    const lead = tied ? "tied" : r > d ? "rep" : "dem";
    const leader = tied ? (name === "Senate" ? "Tied — your VP breaks it" : "Tied") : r > d ? "Republican" : "Democrat";
    const dPct = (d / total) * 100;
    return `<div class="chamber">
      <span class="eyebrow">${name}</span>
      <div class="chamber__count">
        <span class="chamber__party ${lead}">${leader}</span>
        <span class="chamber__split">${d}D – ${r}R</span>
      </div>
      <div class="seatbar"><i class="d" style="width:${dPct}%"></i><i class="r" style="width:${100 - dPct}%"></i></div>
    </div>`;
  };

  const control = controlLine(state);
  const tiedSenate = senateD === senateR;
  return `<div class="card" style="margin-top:14px">
    <div class="card__head">
      <span class="eyebrow">🏛️ Congress</span>
      <span class="hint">${escapeHtml(control)}</span>
    </div>
    <div class="chambers">
      ${chamber("House", houseD, houseR, 435)}
      ${chamber("Senate", senateD, senateR, 100)}
    </div>
  </div>
  ${chamberRow(state, "house", "House of Representatives", `${houseD}D – ${houseR}R`, houseMath(state))}
  ${chamberRow(state, "senate", "United States Senate", `${senateD}D – ${senateR}R`, senateMath(state))}`;
}

const mySeats = (state, chamber) => {
  const c = state.congress;
  if (state.scenario.party === "Republican") return chamber === "house" ? c.houseR : c.senateR;
  if (state.scenario.party === "Democrat") return chamber === "house" ? c.houseD : c.senateD;
  return 0;
};

function houseMath(state) {
  const mine = mySeats(state, "house");
  const rows = [
    ["Seats needed for a simple majority", 218],
    ["Seats needed to override a veto", 290],
  ];
  if (state.scenario.party === "Independent") {
    rows.push(["Your bloc", "None — every bill is negotiated seat by seat"]);
  } else {
    rows.push([`${state.scenario.party} seats`, mine]);
    rows.push(["Margin over the majority line", `${mine - 218 >= 0 ? "+" : ""}${mine - 218}`]);
  }
  return rows;
}

function senateMath(state) {
  const mine = mySeats(state, "senate");
  const rows = [
    ["Seats needed for a simple majority", "51 (50 with your VP breaking the tie)"],
    ["Seats needed to break a filibuster", 60],
    ["Seats needed to override a veto", 67],
  ];
  if (state.scenario.party === "Independent") {
    rows.push(["Your bloc", "None — every bill is negotiated seat by seat"]);
  } else {
    rows.push([`${state.scenario.party} seats`, mine]);
    rows.push(["Short of a filibuster-proof majority by", Math.max(0, 60 - mine)]);
  }
  return rows;
}

function controlLine(state) {
  const { houseD, houseR, senateD, senateR } = state.congress;
  const p = state.scenario.party;
  if (p === "Independent") return "You have no bloc — every vote is negotiated";
  // A tied Senate counts as yours: the Vice President casts the deciding vote.
  const mine = p === "Republican"
    ? [houseR > houseD, senateR >= senateD]
    : [houseD > houseR, senateD >= senateR];
  if (mine[0] && mine[1]) return "Your party controls both chambers";
  if (!mine[0] && !mine[1]) return "The opposition controls both chambers";
  return "Congress is split between the parties";
}

function vpCard(state) {
  const vp = (state.cabinet || []).find((c) => c.id === "vp");
  if (!vp) return "";
  const meta = state.scenario.vp;
  return `<div class="card" id="vpCard">
    <span class="eyebrow">🇺🇸 Vice President</span>
    <div class="person__top" style="margin-top:10px">
      <div>
        <div class="person__name">${escapeHtml(vp.name)}</div>
        <div class="person__tags">${escapeHtml([meta?.age, meta?.region, meta?.background, meta?.ideology].filter(Boolean).join(" · ") || vp.focus)}</div>
        ${meta?.bio ? `<p class="person__bio">${escapeHtml(meta.bio)}</p>` : ""}
      </div>
      <div class="person__stats">
        Competence: <b>${vp.competence}</b><br />Loyalty: <b>${vp.loyalty}</b>
        <div style="margin-top:8px"><button class="btn btn--sm" data-advisor="vp">💬 Talk</button></div>
      </div>
    </div>
    <div class="field" style="margin:16px 0 0">
      <span class="eyebrow">Portfolio</span>
      <select id="vpPortfolio" style="margin-top:8px">
        ${PORTFOLIOS.map((p) => `<option value="${p.value}"${
          (meta?.portfolio || "") === p.value ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("")}
      </select>
    </div>
  </div>`;
}

/**
 * The Twenty-Fifth Amendment, before it happens.
 *
 * Section 4 needs three things at once: a Vice President willing to lead it, a
 * majority of the cabinet willing to sign, and a presidency visibly failing.
 * All three are things the player can act on, so all three are shown — a
 * declaration should never be the first the player hears of it.
 */
/**
 * The primary, before it happens.
 *
 * Party standing is now the thing that decides whether you are challenged, so
 * it has to be legible as a threat and not just a number in a tile. Shown from
 * the year before, while there is still time to do something about it.
 */
function primaryWarning(state) {
  if (state.over || state.phase || state.primaryHeld) return "";
  if ((state.term || 1) >= 2 && !state.specialActions?.termLimitGone) return "";
  if (state.scenario.party === "Independent" || state.congressDissolved) return "";
  if (state.month < 24 || state.month >= 40) return "";

  const standing = partySupport(state);
  if (standing >= 42 && state.approval >= 40) return "";

  return `<div class="alarm-note">
    <b>Your own party is the first election you have to win.</b>
    Your coalition is at ${standing}. If it is still there in ${Math.max(1, 40 - state.month)} months,
    somebody from your own side files against you — and what you have signed since taking office
    is the case they will make.
  </div>`;
}

function twentyFifthWarning(state) {
  const vp = (state.cabinet || []).find((c) => c.id === "vp");
  if (!vp || state.congressDissolved || state.over) return "";

  const cabinet = (state.cabinet || []).filter((c) => c.id !== "vp" && c.id !== "spouse");
  const signatories = cabinet.filter((c) => c.loyalty < 45).length;
  const locks = [
    vp.loyalty < 45,
    signatories > cabinet.length / 2,
    state.stability < 35 && state.approval < 32,
  ];
  const open = locks.filter(Boolean).length;
  if (open < 2) return "";

  const missing = !locks[0] ? `${escapeHtml(vp.name)} will not lead it`
    : !locks[1] ? "not enough of the cabinet would sign"
    : "the presidency is not visibly failing — yet";

  return `<div class="alarm-note">
    <b>${open === 3 ? "Your cabinet can remove you." : "Your cabinet is close to being able to remove you."}</b>
    ${open === 3
      ? `${escapeHtml(vp.name)} and ${signatories} secretaries could declare you unable to serve at any time. ` +
        `Two of the three things they need are things you control: who sits in those chairs, and how they feel about you.`
      : `Two of the three conditions for a Twenty-Fifth Amendment declaration are met — only that ${missing}.`}
  </div>`;
}

function cabinetCard(state) {
  // The VP and the spouse each have a card of their own above this one.
  const others = (state.cabinet || []).filter((c) => c.id !== "vp" && c.id !== "spouse");
  const avg = Math.round(others.reduce((s, c) => s + c.loyalty, 0) / (others.length || 1));
  const weakest = [...others].sort((a, b) => a.loyalty - b.loyalty)[0];
  return `<div class="card${twentyFifthWarning(state) ? " card--alarm" : ""}">
    <div class="card__head">
      <span class="eyebrow">🏛️ Cabinet & inner circle</span>
      <span class="hint">Avg loyalty: ${avg}${
        weakest && weakest.loyalty < 45 ? ` · ${escapeHtml(weakest.name.split(" ").at(-1))} is a problem` : ""}
        <button class="btn btn--sm" id="manageCabinet" style="margin-left:10px">Manage →</button></span>
    </div>
    ${twentyFifthWarning(state)}
    <div class="cabinet">
      ${others.map((c) => `
        <button class="cab" data-advisor="${c.id}" title="Talk to ${escapeHtml(c.name)}">
          <span class="cab__role">${escapeHtml(c.role)}</span>
          <span class="cab__name">${escapeHtml(c.name.split(" ").slice(-1)[0])}</span>
          ${c.ideology ? `<span class="cab__ideology${c.fringe ? " is-fringe" : ""}">${escapeHtml(c.ideology)}</span>` : ""}
          ${track(c.loyalty, toneFor(c.loyalty))}
        </button>`).join("")}
    </div>
  </div>`;
}

function deskCard(state) {
  const live = liveArcs(state);
  const scars = scarArcs(state);
  if (!live.length && !scars.length) {
    return `<div class="card">
      <div class="card__head"><span class="eyebrow">🗂️ On your desk</span><span class="hint">Nothing carried over</span></div>
      <p class="hint" style="margin:0">Your desk is clear. Whatever happens next month, you start it fresh.</p>
    </div>`;
  }
  const item = (a, scar) => `
    <div class="desk__item${scar ? " desk__item--scar" : a.severity >= 5 ? " desk__item--sev5" : ""}">
      <div>
        <div class="desk__title">${escapeHtml(a.title)}</div>
        <div class="desk__meta">${scar ? "Permanent scar" : DOMAIN_LABEL[a.domain] || "—"}${a.monthsActive ? ` · ${a.monthsActive} mo. open` : ""}</div>
      </div>
      ${scar ? "" : `<span class="pips${a.severity >= 5 ? " pips--danger" : ""}">${
        [1, 2, 3, 4, 5].map((i) => `<i class="${i <= a.severity ? "on" : ""}"></i>`).join("")}</span>`}
    </div>`;
  return `<div class="card">
    <div class="card__head">
      <span class="eyebrow">🗂️ On your desk</span>
      <span class="hint">${live.length} open${scars.length ? ` · ${scars.length} scar${scars.length > 1 ? "s" : ""}` : ""}</span>
    </div>
    <div class="desk">${live.map((a) => item(a, false)).join("")}${scars.map((a) => item(a, true)).join("")}</div>
  </div>`;
}

function economyCard(state) {
  const e = state.economy;
  const cell = (label, value) => `<div class="tile tile--compact">
    <span class="eyebrow">${label}</span>
    <div class="tile__value">${value}</div>
  </div>`;
  return `<div class="card" style="margin-top:14px">
    <span class="eyebrow">📈 The economy</span>
    <div class="tiles tiles--four">
      ${cell("GDP growth", e.gdpGrowth.toFixed(1) + "%")}
      ${cell("Unemployment", e.unemployment.toFixed(1) + "%")}
      ${cell("Inflation", e.inflation.toFixed(1) + "%")}
      ${cell("National debt", "$" + e.debt.toFixed(1) + "T")}
    </div>
  </div>`;
}

function stakeholderCard(state) {
  return `<div class="card" style="margin:0">
    <span class="eyebrow">🤝 Key stakeholder approval</span>
    <div style="margin-top:14px">
      ${G.meta.stakeholders.map((s) => {
        const v = state.stakeholders[s.id] ?? 50;
        const tone = toneFor(v);
        return `<div class="stake">
          <span class="stake__name">${escapeHtml(s.name)}</span>
          <span class="stake__track">${track(v, tone)}</span>
          <span class="stake__val" style="color:${tone}">${v}</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function timelineCard(state, startYear) {
  const items = (state.history || []).slice(-7).reverse();
  return `<div class="card" style="margin:0">
    <span class="eyebrow">🗓️ Presidential timeline</span>
    <div style="margin-top:12px">
      ${items.length ? items.map((h) => `
        <div class="timeline__item">
          <span class="timeline__when">${escapeHtml(shortMonthLabel(
            ((h.term || 1) - 1) * 48 + h.month, startYear))}</span>
          <span class="timeline__what">${escapeHtml(h.headline || "—")}
            <b style="color:${h.approvalChange >= 0 ? "var(--green)" : "var(--red)"}">
              ${h.approvalChange >= 0 ? "+" : ""}${h.approvalChange}</b>
          </span>
        </div>`).join("")
        : `<p class="hint" style="margin:0">No actions taken yet. The record starts with your first decision.</p>`}
    </div>
  </div>`;
}

function mapCard(state, { flush = false } = {}) {
  const tiles = Object.entries(G.meta.states).map(([code, info]) => {
    const v = state.stateApproval[code] ?? 50;
    return `<span class="map__tile" style="grid-column:${info.c + 1};grid-row:${info.r + 1};background:${mapTone(v)}"
      title="${escapeHtml(info.name)}: ${v}% · ${info.ev} EV">${code}</span>`;
  }).join("");
  return `<div class="card" style="margin:${flush ? "0" : "14px 0 0"}">
    <div class="card__head">
      <span class="eyebrow">🗺️ The map</span>
      <span class="map__legend"><i style="background:#b0453f"></i>oppose<i style="background:#8b96a8"></i>even<i style="background:#2f9e6e"></i>support</span>
    </div>
    <div class="map">${tiles}</div>
    <p class="hint" style="margin:12px 0 0">${favorableEV(state)} electoral votes currently favourable — 270 wins.</p>
  </div>`;
}

function mapTone(v) {
  const mix = (a, b, t) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
  if (v >= 52) return mix([139, 150, 168], [47, 158, 110], Math.min(1, (v - 52) / 20));
  if (v <= 48) return mix([139, 150, 168], [176, 69, 63], Math.min(1, (48 - v) / 20));
  return "rgb(139,150,168)";
}

// #dashBody survives every re-render, so its listeners are attached exactly
// once — binding them per render would stack duplicates and fire each action
// as many times as the board had been painted.
let wired = false;

function wire(handlers) {
  const body = $("dashBody");
  const refresh = () => renderDashboard(handlers, null);
  if (wired) return;
  wired = true;

  body.addEventListener("click", (e) => {
    const advisor = e.target.closest("[data-advisor]");
    if (advisor) return openDrawer(advisor.dataset.advisor, refresh);
    if (e.target.id === "toCareers") return handlers.onCareers();
    if (e.target.id === "playBtn") return handlers.onPlay();
    if (e.target.id === "legacyBtn") return handlers.onLegacy();
    if (e.target.id === "resignBtn") return handlers.onResign();
    if (e.target.id === "manageCabinet") return openCabinetManager(refresh);
  });

  // A VP's portfolio can be reassigned at any time; it changes what they own
  // publicly, and therefore what they are blamed for.
  body.addEventListener("change", (e) => {
    if (e.target.id !== "vpPortfolio") return;
    const vp = G.state.cabinet.find((c) => c.id === "vp");
    G.state = {
      ...G.state,
      scenario: { ...G.state.scenario, vp: { ...(G.state.scenario.vp || {}), portfolio: e.target.value } },
    };
    if (vp) {
      vp.focus = e.target.value
        ? `${e.target.value}, politics & the next election`
        : "politics & the next election";
    }
    saveCareer();
  });

  wireBills(body, refresh);
  wireInstitutions(body, refresh);
  wireFirstLady(body, refresh);
  wireSpecialActions(body, refresh);
}

/** The full cabinet, sortable by the number that decides who to worry about. */
function openCabinetManager(refresh) {
  const members = [...(G.state.cabinet || [])].sort((a, b) => a.loyalty - b.loyalty);
  const modal = el("div", "drawer", `
    <div class="drawer__box">
      <div class="drawer__head">
        <div>
          <div class="drawer__name">Manage the Cabinet</div>
          <div class="drawer__role">Least loyal first. Talk to anyone, or dismiss them from their card.</div>
        </div>
        <button class="close-x" data-close aria-label="Close">✕</button>
      </div>
      <div class="drawer__log">
        ${members.map((m) => `
          <button class="mate" data-manage="${m.id}">
            <span class="row__body">
              <span class="mate__name">${m.emoji} ${escapeHtml(m.name)}</span>
              <span class="mate__tags">${escapeHtml(m.role)} · ${escapeHtml(m.focus)}</span>
            </span>
            <span class="mate__stats">
              Competence: <b>${m.competence}</b><br />
              Loyalty: <b style="color:${toneFor(m.loyalty)}">${m.loyalty}</b>
            </span>
          </button>`).join("")}
      </div>
    </div>`);

  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) return modal.remove();
    const row = e.target.closest("[data-manage]");
    if (!row) return;
    modal.remove();
    openDrawer(row.dataset.manage, refresh);
  });
}
