"use strict";

import { $, show, escapeHtml, monthLabel, shortMonthLabel, track, toneFor } from "./util.js";
import { G } from "./store.js";
import { openDrawer } from "./drawer.js";

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
 * How the president's own coalition is holding. Averages the stakeholders who
 * lean the president's way; for an independent, the whole board.
 */
export function partySupport(state) {
  const sign = state.scenario.party === "Republican" ? 1 : state.scenario.party === "Democrat" ? -1 : 0;
  const relevant = G.meta.stakeholders.filter((s) => {
    if (!sign) return true;
    const lean = STAKE_LEAN[s.id] ?? 0;
    return Math.sign(lean) === sign;
  });
  const pool = relevant.length ? relevant : G.meta.stakeholders;
  const total = pool.reduce((sum, s) => sum + (state.stakeholders[s.id] ?? 50), 0);
  return Math.round(total / (pool.length || 1));
}

// Mirrors STAKEHOLDERS in the engine — only the sign matters here.
const STAKE_LEAN = {
  wall_street: 1, big_business: 1, pentagon: 0.5, labor: -1,
  greens: -1, civil_rights: -1, gun_owners: 1, faith: 0.7,
};

function timelineCopy(state) {
  const monthsLeft = TERM - state.month + 1;
  if (state.phase === "campaign") return ["Election season", "The country is deciding whether to keep you."];
  if (state.month <= 6) return [`1st Term · ${24 - state.month} months until the mid-term election`, "The honeymoon period. Use it wisely."];
  if (state.month <= 22) return [`1st Term · ${Math.max(0, 24 - state.month)} months until the mid-term election`, "The window for hard votes is closing."];
  if (state.month <= 44) return [`1st Term · ${monthsLeft} months left in the term`, "Governing season. The record you run on is being written now."];
  return [`1st Term · ${monthsLeft} months left in the term`, "The campaign is already underway in everything but name."];
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
        <h2 class="display display--md">${monthLabel(state.month, startYear)}</h2>
        <div class="dash-head__sub">${escapeHtml(s.scenarioName || "Political Career")}</div>
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
          : `<button class="btn btn--blue" id="playBtn">Play ${shortMonthLabel(state.month, startYear)} →</button>`}
      </div>
    </div>

    <div class="tiles">
      ${tile("Net approval", approval, deltaHtml(delta), "Voter mood", toneFor(approval))}
      ${tile("Government stability", stability, "Net — 0", "Cabinet & agency support", toneFor(stability))}
      ${tile(`${partyLabel} stability`, party, "Net — 0", "Internal party support", toneFor(party))}
    </div>

    ${congressCard(state)}
    ${deskCard(state)}
    ${courtCard(state)}
    ${vpCard(state)}
    ${cabinetCard(state)}

    <div class="grid-2" style="margin-top:14px">
      ${timelineCard(state, startYear)}
      ${stakeholderCard(state)}
    </div>

    ${economyCard(state)}
    ${mapCard(state)}`;

  wire(handlers);
  show("dash");
}

function tile(label, value, deltaHtml, sub, tone) {
  return `<div class="tile">
    <span class="eyebrow">${escapeHtml(label)}</span>
    <div class="tile__value">${value}%</div>
    <div class="tile__delta">${deltaHtml}</div>
    <div class="tile__sub">${escapeHtml(sub)}</div>
    ${track(value, tone)}
  </div>`;
}

function congressCard(state) {
  const { houseD, houseR, senateD, senateR } = state.congress;
  const chamber = (name, d, r, total) => {
    const lead = r > d ? "rep" : "dem";
    const leader = r > d ? "Republican" : "Democrat";
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
  ${rosterRow("House of Representatives", `${houseD}D – ${houseR}R`, houseMath(state))}
  ${rosterRow("United States Senate", `${senateD}D – ${senateR}R`, senateMath(state))}`;
}

/** The seat maths that actually decides what a president can pass. */
function rosterRow(title, split, lines) {
  return `<details class="roster">
    <summary>
      <span class="eyebrow">🏛️ ${escapeHtml(title)} <b style="color:var(--ink)">${split}</b></span>
      <span class="row__chevron">▾</span>
    </summary>
    <div class="roster__body">
      ${lines.map(([k, v]) => `<div class="record__row"><span>${k}</span><b>${v}</b></div>`).join("")}
    </div>
  </details>`;
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
  const mine = p === "Republican"
    ? [houseR > houseD, senateR > senateD]
    : [houseD > houseR, senateD > senateR];
  if (mine[0] && mine[1]) return "Your party controls both chambers";
  if (!mine[0] && !mine[1]) return "The opposition controls both chambers";
  return "Congress is split between the parties";
}

function courtCard(state) {
  const { conservative, liberal } = state.court;
  const seats = [];
  // The badge is the justice's age; the crown marks the Chief Justice, who is
  // seated with whichever wing holds the majority.
  const chiefWing = conservative >= liberal ? "con" : "lib";
  const seat = (wing, age, chief) =>
    `<span class="justice justice--${wing}" title="${chief ? "Chief Justice, " : ""}age ${age}">
      ${chief ? `<span class="justice__crown">👑</span>` : ""}${age}</span>`;
  for (let i = 0; i < conservative; i++) seats.push(seat("con", 68 + i * 3, chiefWing === "con" && i === 1));
  for (let i = 0; i < liberal; i++) seats.push(seat("lib", 71 + i * 4, chiefWing === "lib" && i === 1));
  const label = conservative >= liberal
    ? `Conservative ${conservative}–${liberal} majority`
    : `Liberal ${liberal}–${conservative} majority`;
  return `<div class="card">
    <div class="card__head">
      <span class="eyebrow">⚖️ Supreme Court</span>
      <span class="hint">${label}</span>
    </div>
    <div class="bench">${seats.join("")}</div>
  </div>`;
}

function vpCard(state) {
  const vp = (state.cabinet || []).find((c) => c.id === "vp");
  if (!vp) return "";
  const meta = state.scenario.vp;
  return `<div class="card">
    <span class="eyebrow">🇺🇸 Vice President</span>
    <div class="person__top" style="margin-top:10px">
      <div>
        <div class="person__name">${escapeHtml(vp.name)}</div>
        <div class="person__tags">${escapeHtml([meta?.age, meta?.region, meta?.background, meta?.ideology].filter(Boolean).join(" · ") || vp.focus)}</div>
        ${meta?.bio ? `<p class="person__bio">${escapeHtml(meta.bio)}</p>` : ""}
        ${meta?.portfolio ? `<p class="hint" style="margin-top:6px">Portfolio: <b>${escapeHtml(meta.portfolio)}</b></p>` : ""}
      </div>
      <div class="person__stats">
        Competence: <b>${vp.competence}</b><br />Loyalty: <b>${vp.loyalty}</b>
        <div style="margin-top:8px"><button class="btn btn--sm" data-advisor="vp">💬 Talk</button></div>
      </div>
    </div>
  </div>`;
}

function cabinetCard(state) {
  const others = (state.cabinet || []).filter((c) => c.id !== "vp");
  const avg = Math.round(others.reduce((s, c) => s + c.loyalty, 0) / (others.length || 1));
  return `<div class="card">
    <div class="card__head">
      <span class="eyebrow">🏛️ Cabinet & inner circle</span>
      <span class="hint">Avg loyalty: ${avg}</span>
    </div>
    <div class="cabinet">
      ${others.map((c) => `
        <button class="cab" data-advisor="${c.id}" title="Talk to ${escapeHtml(c.name)}">
          <span class="cab__role">${escapeHtml(c.role)}</span>
          <span class="cab__name">${escapeHtml(c.name.split(" ").slice(-1)[0])}</span>
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
          <span class="timeline__when">${escapeHtml(shortMonthLabel(h.month, startYear))}</span>
          <span class="timeline__what">${escapeHtml(h.headline || "—")}
            <b style="color:${h.approvalChange >= 0 ? "var(--green)" : "var(--red)"}">
              ${h.approvalChange >= 0 ? "+" : ""}${h.approvalChange}</b>
          </span>
        </div>`).join("")
        : `<p class="hint" style="margin:0">No actions taken yet. The record starts with your first decision.</p>`}
    </div>
  </div>`;
}

function mapCard(state) {
  const tiles = Object.entries(G.meta.states).map(([code, info]) => {
    const v = state.stateApproval[code] ?? 50;
    return `<span class="map__tile" style="grid-column:${info.c + 1};grid-row:${info.r + 1};background:${mapTone(v)}"
      title="${escapeHtml(info.name)}: ${v}% · ${info.ev} EV">${code}</span>`;
  }).join("");
  return `<div class="card" style="margin-top:14px">
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

function wire(handlers) {
  const body = $("dashBody");
  body.addEventListener("click", (e) => {
    const advisor = e.target.closest("[data-advisor]");
    if (advisor) return openDrawer(advisor.dataset.advisor, () => renderDashboard(handlers, null));
    if (e.target.id === "toCareers") return handlers.onCareers();
    if (e.target.id === "playBtn") return handlers.onPlay();
    if (e.target.id === "legacyBtn") return handlers.onLegacy();
    if (e.target.id === "resignBtn") return handlers.onResign();
  });
}
