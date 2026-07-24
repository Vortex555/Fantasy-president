"use strict";

import { $, show, escapeHtml, monthLabel, loader } from "./util.js";
import { G, saveCareer } from "./store.js";
import { playTurn } from "./api.js";
import { openDrawer } from "./drawer.js";
import { liveArcs } from "./dashboard.js";

const DOMAIN_LABEL = {
  economy: "Economy", security: "National Security", justice: "Law & Justice",
  social: "Society", foreign: "Foreign Affairs", health: "Health & Environment",
};

const ARC_EVENT_LABEL = {
  opened: "New", escalated: "Escalating", holding: "Unchanged", eased: "Eased",
  resolved: "Resolved", detonated: "Blew up", scarred: "Permanent scar",
};

const ARC_EVENT_TONE = {
  opened: "badge--blue", escalated: "badge--amber", holding: "", eased: "badge--live",
  resolved: "badge--live", detonated: "badge--red", scarred: "badge--red",
};

const CHECK_STATUS = {
  passed: { cls: "good", txt: "Passed Congress" },
  compromised: { cls: "warn", txt: "Watered down" },
  blocked: { cls: "bad", txt: "Blocked" },
  executive: { cls: "warn", txt: "Executive action" },
  none: { cls: "", txt: "Unchallenged" },
  upheld: { cls: "good", txt: "Upheld by the court" },
  struck_down: { cls: "bad", txt: "Struck down" },
};

let handlers = {};

/** The briefing: the situation, your team, and the box you write your policy in. */
export function renderBriefing(hooks) {
  handlers = hooks;
  const state = G.state;
  const event = G.event;
  const startYear = state.scenario.startYear || 2025;
  const open = liveArcs(state).filter((a) => a.id !== event?.fromArc);
  // No Hints strips every prompt and suggestion — a blank box and nothing else.
  const noHints = state.scenario.noHints === true;
  const clock = state.scenario.weekly ? { unit: "Week", total: 208 } : { unit: "Month", total: 48 };

  $("turnBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${escapeHtml(state.scenario.presidentName)}</h1>
        <div class="dash-head__sub">${clock.unit} ${state.month} of ${clock.total} · ${Math.round(state.approval)}% approval</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${monthLabel(state.month, startYear)}</h2>
        <div class="dash-head__sub">The situation room</div>
      </div>
    </div>

    <div class="card ${event.detonated ? "brief--urgent" : "card--accent"}">
      <div class="brief__kicker">
        <span class="eyebrow">${event.detonated ? "It blew up" : "This month's situation"}</span>
        ${event.detonated ? `<span class="badge badge--red">Crisis</span>` : ""}
      </div>
      <h2 class="display display--md brief__title">${escapeHtml(event.title)}</h2>
      <p class="brief__body">${escapeHtml(event.brief)}</p>
    </div>

    ${open.length ? `
    <div class="card">
      <div class="card__head">
        <span class="eyebrow">🗂️ Still on your desk</span>
        ${noHints ? "" : `<span class="hint">You can spend this ${clock.unit.toLowerCase()} on one of these instead</span>`}
      </div>
      <div class="desk">
        ${open.map((a) => `
          <div class="desk__item${a.severity >= 5 ? " desk__item--sev5" : ""}">
            <div>
              <div class="desk__title">${escapeHtml(a.title)}</div>
              <div class="desk__meta">${a.severity >= 5 ? "At breaking point" : DOMAIN_LABEL[a.domain] || "—"} · ${a.monthsActive || 1} mo. open</div>
            </div>
            <span class="pips${a.severity >= 5 ? " pips--danger" : ""}">${
              [1, 2, 3, 4, 5].map((i) => `<i class="${i <= a.severity ? "on" : ""}"></i>`).join("")}</span>
          </div>`).join("")}
      </div>
    </div>` : ""}

    <div class="card">
      <div class="card__head">
        <span class="eyebrow">🎙️ Consult your team</span>
        <span class="hint">Their advice reflects their loyalty and their competence</span>
      </div>
      <div class="advisors" id="advisorChips"></div>
    </div>

    <div class="card composer">
      <span class="eyebrow">Your policy response</span>
      ${noHints ? "" : `<p class="hint" style="margin:6px 0 12px">Write it in your own words. Name the agency, the money
        and the message — vague gestures play badly.</p>`}
      <textarea id="policyInput" rows="7" maxlength="1600"
        placeholder="${noHints ? "" : "Exactly how will you respond?"}"></textarea>
      <input id="publicMessage" type="text" maxlength="240"
        placeholder="${noHints ? "" : "Optional: the line you give the cameras…"}" />
      <div class="composer__actions">
        <span class="composer__count" id="charCount">0 / 1600</span>
        <div class="btn-row">
          <button class="btn" id="backToDash">← Dashboard</button>
          <button class="btn btn--primary" id="enactBtn">Enact Policy →</button>
        </div>
      </div>
    </div>`;

  renderAdvisors();
  const input = $("policyInput");
  input.oninput = () => { $("charCount").textContent = `${input.value.length} / 1600`; };
  $("enactBtn").onclick = submitPolicy;
  $("backToDash").onclick = handlers.onDashboard;
  show("turn");
  input.focus();
}

function renderAdvisors() {
  const wrap = $("advisorChips");
  wrap.innerHTML = G.state.cabinet.map((a) => `
    <button class="advisor-chip" data-advisor="${a.id}">
      <span>${a.emoji}</span><span>${escapeHtml(a.role)} <small>· ${escapeHtml(a.name.split(" ").slice(-1)[0])}</small></span>
    </button>`).join("");
  wrap.onclick = (e) => {
    const chip = e.target.closest("[data-advisor]");
    if (chip) openDrawer(chip.dataset.advisor, renderAdvisors);
  };
}

async function submitPolicy() {
  const input = $("policyInput");
  const policy = input.value.trim();
  if (policy.length < 3) {
    input.focus();
    input.style.borderColor = "var(--red)";
    setTimeout(() => (input.style.borderColor = ""), 900);
    return;
  }
  loader(true, G.meta.ai ? "Your team is war-gaming the decision…" : "The consequences are unfolding…");
  try {
    const before = G.state.approval;
    const data = await playTurn(G.state, G.event, policy, $("publicMessage").value.trim());
    G.state = data.state;
    G.pendingEvent = data.result.nextEvent;
    saveCareer();
    renderConsequences(data.result, G.state.approval - before);
  } catch (err) {
    alert("The turn could not be resolved: " + err.message);
  } finally {
    loader(false);
  }
}

/** The verdict: what the policy actually did to the country. */
function renderConsequences(result, delta) {
  const state = G.state;
  const startYear = state.scenario.startYear || 2025;
  const d = result.approvalChange ?? delta ?? 0;
  const tone = d > 0.05 ? "delta--up" : d < -0.05 ? "delta--down" : "";

  const sections = [
    `<div class="dash-head">
      <div>
        <h1 class="display display--lg">The Verdict</h1>
        <div class="dash-head__sub">${escapeHtml(state.scenario.presidentName)} · ${Math.round(state.approval)}% approval</div>
      </div>
      <div class="dash-head__right">
        <div class="verdict__delta ${tone}">${d > 0 ? "+" : ""}${d.toFixed(1)}</div>
        <div class="dash-head__sub">approval this month</div>
      </div>
    </div>`,

    `<div class="card card--accent">
      <span class="eyebrow">West Wing briefing</span>
      <p class="analysis" style="margin-top:8px">${escapeHtml(result.analysis || "")}</p>
    </div>`,
  ];

  if (result.checks) {
    sections.push(`<div class="card">
      <span class="eyebrow">⚖️ Checks &amp; balances</span>
      <div class="grid-2" style="margin-top:12px">
        ${checkCard("Congress", result.checks.congress)}
        ${checkCard("Supreme Court", result.checks.court)}
      </div>
    </div>`);
  }

  if (result.rollout) {
    sections.push(`<div class="card">
      <span class="eyebrow">🛠️ Rollout</span>
      <p class="analysis" style="margin-top:8px">${escapeHtml(result.rollout.name)}, your
        ${escapeHtml(result.rollout.role)}, ${escapeHtml(result.rollout.note)}.</p>
    </div>`);
  }

  if (result.arcEvents?.length) {
    sections.push(`<div class="card">
      <span class="eyebrow">🗂️ Ongoing situations</span>
      <div style="margin-top:12px">
        ${result.arcEvents.map((e) => `
          <div class="arc-event">
            <div class="arc-event__top">
              <span class="badge ${ARC_EVENT_TONE[e.kind] || ""}">${ARC_EVENT_LABEL[e.kind] || escapeHtml(e.kind)}</span>
              <span class="arc-event__title">${escapeHtml(e.title || "")}</span>
              <span class="pips" style="margin-left:auto">${
                [1, 2, 3, 4, 5].map((i) => `<i class="${i <= (e.severity || 0) ? "on" : ""}"></i>`).join("")}</span>
            </div>
            <div class="arc-event__detail">${escapeHtml(e.detail || "")}
              ${e.note ? `<span style="color:var(--faint)">${escapeHtml(e.note)}</span>` : ""}</div>
          </div>`).join("")}
      </div>
    </div>`);
  }

  if (result.press?.length) {
    sections.push(`<div class="card">
      <span class="eyebrow">📰 The morning front pages</span>
      <div class="grid-3" style="margin-top:12px">
        ${result.press.map((p) => {
          const lean = ["left", "center", "right"].includes(p.lean) ? p.lean : "center";
          return `<div class="press press--${lean}">
            <div class="press__outlet">${escapeHtml(p.outlet || "")}</div>
            <div class="press__headline">${escapeHtml(p.headline || "")}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`);
  }

  sections.push(...subsystemSections(result));

  if (result.personas?.length) sections.push(focusGroup(result.personas));

  const shifts = (result.stakeholders || []).filter((s) => Math.abs(s.change || 0) >= 1)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  if (shifts.length) {
    sections.push(`<div class="card">
      <span class="eyebrow">🤝 Stakeholder reactions</span>
      <div class="grid-3" style="margin-top:12px">
        ${shifts.map((s) => `<div class="shift"><span>${escapeHtml(s.name || "")}</span>
          <b class="${s.change > 0 ? "up" : "down"}">${s.change > 0 ? "+" : ""}${s.change}</b></div>`).join("")}
      </div>
    </div>`);
  }

  const next = state.over
    ? `<button class="btn btn--primary btn--block" id="nextBtn">See Your Legacy →</button>`
    : state.phase === "campaign"
      ? `<button class="btn btn--primary btn--block" id="nextBtn">Enter the Campaign →</button>`
      : `<button class="btn btn--primary btn--block" id="nextBtn">Continue to ${monthLabel(state.month, startYear)} →</button>`;

  sections.push(`<div class="next-step"><div style="min-width:300px">${next}</div></div>`);

  $("turnBody").innerHTML = sections.join("");
  $("nextBtn").onclick = () => {
    if (state.over) return handlers.onLegacy();
    if (state.phase === "campaign") return handlers.onCampaign();
    G.event = G.pendingEvent || {
      title: "A Quiet Month",
      brief: "No single crisis dominates the news, which gives you rare room to set your own agenda. What will you push?",
    };
    saveCareer();
    handlers.onDashboard();
  };
  show("turn");
}

/**
 * What the optional subsystems did this month. Each block only appears when
 * its rule is on and something actually moved — a card that says "no change"
 * every month teaches the player to stop reading.
 */
function subsystemSections(result) {
  const out = [];

  if (result.warEvents?.length) {
    out.push(`<div class="card">
      <span class="eyebrow">⚔️ The deployments</span>
      <div style="margin-top:12px">
        ${result.warEvents.map((e) => `
          <div class="arc-event">
            <div class="arc-event__top">
              <span class="badge ${e.kind === "withdrawn" || e.kind === "settled" ? "badge--blue"
                : e.kind === "objective_met" ? "badge--live" : "badge--red"}">${escapeHtml(e.war)}</span>
            </div>
            <div class="arc-event__detail">${escapeHtml(e.detail)}</div>
          </div>`).join("")}
      </div>
    </div>`);
  }

  const covert = result.covertOutcome;
  if (covert?.events?.length) {
    out.push(`<div class="card">
      <span class="eyebrow">🎯 The shadow war</span>
      <div style="margin-top:12px">
        ${covert.events.map((e) => `
          <div class="arc-event">
            <div class="arc-event__top">
              <span class="badge ${e.kind === "disrupted" ? "badge--live" : "badge--red"}">${
                escapeHtml(e.kind.replace("_", " "))}</span>
            </div>
            <div class="arc-event__detail">${escapeHtml(e.detail)}</div>
          </div>`).join("")}
      </div>
    </div>`);
  }

  const amendment = result.amendment;
  if (amendment && amendment.kind !== "pending") {
    out.push(`<div class="card ${amendment.kind === "ratified" ? "card--blue" : "card--amber"}">
      <span class="eyebrow">📜 ${amendment.kind === "ratified" ? "Ratified" : "Died in the states"}</span>
      <p class="analysis" style="margin-top:8px">${escapeHtml(amendment.title)}${
        amendment.kind === "expired" ? ` fell short at ${amendment.ratified} states.` : " is now part of the Constitution."}</p>
    </div>`);
  } else if (amendment?.kind === "pending") {
    out.push(`<div class="card card--amber">
      <span class="eyebrow">📜 Out with the states</span>
      <p class="analysis" style="margin-top:8px">${escapeHtml(amendment.title)} —
        ${amendment.ratified} of ${amendment.needed} states have ratified.</p>
    </div>`);
  }

  const society = (result.societyMoves || []).filter((m) => Math.abs(m.change) > 0);
  if (society.length) {
    out.push(`<div class="card">
      <span class="eyebrow">📊 The country itself</span>
      <div class="grid-3" style="margin-top:12px">
        ${society.map((m) => `<div class="shift"><span>${escapeHtml(m.name)}</span>
          <b class="${m.change > 0 ? "up" : "down"}">${m.change > 0 ? "+" : ""}${m.change}</b></div>`).join("")}
      </div>
    </div>`);
  }

  const foreign = (result.foreignMoves || []).filter((m) => Math.abs(m.change) >= 2);
  if (foreign.length) {
    out.push(`<div class="card">
      <span class="eyebrow">🌐 Standing in the world</span>
      <div class="grid-3" style="margin-top:12px">
        ${foreign.map((m) => `<div class="shift"><span>${escapeHtml(m.name)}</span>
          <b class="${m.change > 0 ? "up" : "down"}">${m.change > 0 ? "+" : ""}${m.change}</b></div>`).join("")}
      </div>
    </div>`);
  }

  return out;
}

function checkCard(label, c) {
  const info = CHECK_STATUS[c?.status] || CHECK_STATUS.none;
  const note = c?.note || (c?.status === "none" ? "No legal challenge was mounted." : "");
  return `<div class="check${info.cls ? ` check--${info.cls}` : ""}">
    <span class="eyebrow">${label}</span>
    <div class="check__status">${info.txt}</div>
    ${note ? `<div class="check__note">${escapeHtml(note)}</div>` : ""}
    ${c?.tally ? tally(c.tally) : ""}
  </div>`;
}

function tally(t) {
  return `<div class="tally">${[["House", t.house], ["Senate", t.senate]].map(([name, ch]) => {
    const yes = (ch.yes / ch.total) * 100;
    return `<div class="tally__row">
      <div class="tally__head"><span>${name}</span><span>${ch.yes}–${ch.no} ${ch.passed ? "✓ passed" : "✗ failed"}</span></div>
      <div class="tally__bar">
        <span class="yes" style="width:${yes}%"></span><span class="no" style="width:${100 - yes}%"></span>
        <span class="mark" style="left:${(ch.threshold / ch.total) * 100}%"></span>
      </div>
      <div class="tally__split">Democrats ${ch.dYes} yes · Republicans ${ch.rYes} yes · ${ch.threshold} needed</div>
    </div>`;
  }).join("")}</div>`;
}

function focusGroup(personas) {
  const speaking = personas.filter((p) => p.quote);
  const silent = personas.filter((p) => !p.quote);
  const counts = { approve: 0, mixed: 0, disapprove: 0 };
  for (const p of personas) counts[p.mood] = (counts[p.mood] || 0) + 1;

  return `<div class="card">
    <div class="card__head">
      <span class="eyebrow">🗣️ Focus group — ${personas.length} voters</span>
    </div>
    <div class="mood-bar">
      <i class="approve" style="flex:${counts.approve || 0.0001}"></i>
      <i class="mixed" style="flex:${counts.mixed || 0.0001}"></i>
      <i class="disapprove" style="flex:${counts.disapprove || 0.0001}"></i>
    </div>
    <div class="mood-legend">
      <b class="approve">${counts.approve}</b> approve ·
      <b class="mixed">${counts.mixed}</b> mixed ·
      <b class="disapprove">${counts.disapprove}</b> disapprove
    </div>
    <div class="grid-3" style="margin-top:14px">
      ${speaking.map((p) => {
        const mood = ["approve", "disapprove", "mixed"].includes(p.mood) ? p.mood : "mixed";
        return `<div class="voter">
          <div class="voter__top">
            <div>
              <div class="voter__name">${escapeHtml(p.name || "")}</div>
              <div class="voter__group">${escapeHtml(p.group || "")}</div>
            </div>
            <span class="pill ${mood}">${mood}</span>
          </div>
          <div class="voter__quote">“${escapeHtml(p.quote || "")}”</div>
        </div>`;
      }).join("")}
    </div>
    ${silent.length ? `
      <p class="hint" style="margin:16px 0 8px">The rest of the panel — ${silent.length} more reacting quietly</p>
      <div class="chips">${silent.map((p) =>
        `<span class="${escapeHtml(p.mood || "mixed")}" title="${escapeHtml(p.group || "")}">${escapeHtml(p.name || "")}</span>`).join("")}</div>` : ""}
  </div>`;
}
