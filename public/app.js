"use strict";

const G = {
  meta: null,
  state: null,
  event: null,        // current situation awaiting a policy
  pendingEvent: null, // next month's event, revealed on "continue"
  party: "Independent",
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screenId).classList.add("active");
}
function loader(on, text) {
  $("loaderText").textContent = text || "The situation is developing…";
  $("loader").classList.toggle("hidden", !on);
}

// ---------------- init ----------------
init();
async function init() {
  try {
    const res = await fetch("/api/meta");
    G.meta = await res.json();
  } catch {
    G.meta = { ai: false, states: {}, stakeholders: [] };
  }
  const badge = $("modeBadge");
  if (G.meta.ai) {
    badge.textContent = "● Live AI simulation (Claude)";
    badge.classList.add("ai");
  } else {
    badge.textContent = "● Local simulation mode — set ANTHROPIC_API_KEY for live AI turns";
  }
  wireSetup();
  show("setup");
}

function wireSetup() {
  $("partyPicker").addEventListener("click", (e) => {
    const b = e.target.closest(".party");
    if (!b) return;
    document.querySelectorAll(".party").forEach((p) => p.classList.remove("active"));
    b.classList.add("active");
    G.party = b.dataset.party;
  });
  $("startApproval").addEventListener("input", (e) => {
    $("approvalVal").textContent = e.target.value;
  });
  $("setupForm").addEventListener("submit", (e) => {
    e.preventDefault();
    startGame();
  });
}

async function startGame() {
  const scenario = {
    presidentName: $("presidentName").value.trim() || "Alex Rivera",
    party: G.party,
    era: $("eraSelect").value,
    startApproval: Number($("startApproval").value),
  };
  loader(true, "Preparing the inauguration…");
  try {
    const res = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    G.state = data.state;
    G.event = data.event;
    renderDashboard(G.state, null);
    renderBriefing(G.event, G.state);
    show("game");
    $("game").classList.add("active");
    $("mainScroll").scrollTop = 0;
  } catch (err) {
    alert("Could not start the game: " + err.message);
  } finally {
    loader(false);
  }
}

// ---------------- dashboard ----------------
function renderDashboard(state, delta) {
  $("dashName").textContent = state.scenario.presidentName;
  const pc = { Democrat: "Democratic", Republican: "Republican", Independent: "Independent" }[state.scenario.party];
  $("dashSub").textContent = `${pc} President · Month ${state.month}`;

  // approval ring
  const a = state.approval;
  $("approvalNum").textContent = Math.round(a);
  const ring = $("approvalRing");
  const circ = 2 * Math.PI * 52;
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ * (1 - a / 100);
  ring.style.stroke = a >= 50 ? "var(--good)" : a >= 40 ? "var(--gold)" : "var(--bad)";

  const dEl = $("approvalDelta");
  if (delta != null && Math.abs(delta) >= 0.1) {
    dEl.textContent = (delta > 0 ? "▲ +" : "▼ ") + delta.toFixed(1);
    dEl.className = "ring-delta " + (delta > 0 ? "up" : "down");
  } else {
    dEl.textContent = "";
    dEl.className = "ring-delta";
  }

  $("stabilityVal").textContent = Math.round(state.stability);
  $("monthVal").textContent = state.month;
  $("evVal").textContent = electoralFavorable(state);

  const e = state.economy;
  $("ecoGdp").textContent = e.gdpGrowth.toFixed(1) + "%";
  $("ecoUnemp").textContent = e.unemployment.toFixed(1) + "%";
  $("ecoInf").textContent = e.inflation.toFixed(1) + "%";
  $("ecoDebt").textContent = "$" + e.debt.toFixed(1) + "T";

  renderSeats("houseBar", state.congress.houseD, state.congress.houseR, 435);
  renderSeats("senateBar", state.congress.senateD, state.congress.senateR, 100);

  renderStakeholders(state);
  renderMap(state);
}

function electoralFavorable(state) {
  const S = G.meta.states;
  let ev = 0;
  for (const [code, info] of Object.entries(S)) {
    if ((state.stateApproval[code] ?? 50) >= 52) ev += info.ev;
  }
  return ev;
}

function renderSeats(id, d, r, total) {
  const bar = $(id);
  bar.innerHTML = "";
  const dPct = (d / total) * 100;
  const dDiv = el("div", "d", d);
  dDiv.style.width = dPct + "%";
  const rDiv = el("div", "r", r);
  rDiv.style.width = (100 - dPct) + "%";
  bar.append(dDiv, rDiv);
}

function renderStakeholders(state) {
  const list = $("stakeList");
  list.innerHTML = "";
  for (const s of G.meta.stakeholders) {
    const v = state.stakeholders[s.id] ?? 50;
    const row = el("div", "stake-row");
    const color = v >= 60 ? "var(--good)" : v >= 40 ? "var(--gold)" : "var(--bad)";
    row.innerHTML = `
      <span class="sname" title="${s.name}">${s.name}</span>
      <span class="stake-track"><span class="stake-fill" style="width:${v}%;background:${color}"></span></span>
      <span class="stake-val" style="color:${color}">${v}</span>`;
    list.appendChild(row);
  }
}

function approvalColor(v) {
  // diverging: red (low) → slate (mid) → green (high)
  if (v >= 52) {
    const t = Math.min(1, (v - 52) / 20);
    return mix([90, 106, 134], [63, 185, 138], t);
  } else if (v <= 48) {
    const t = Math.min(1, (48 - v) / 20);
    return mix([90, 106, 134], [181, 69, 63], t);
  }
  return "rgb(90,106,134)";
}
function mix(a, b, t) {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function renderMap(state) {
  const map = $("usMap");
  map.innerHTML = "";
  for (const [code, info] of Object.entries(G.meta.states)) {
    const v = state.stateApproval[code] ?? 50;
    const tile = el("div", "tile", code);
    tile.style.gridColumn = info.c + 1;
    tile.style.gridRow = info.r + 1;
    tile.style.background = approvalColor(v);
    tile.title = `${info.name}: ${v}% approval · ${info.ev} EV`;
    map.appendChild(tile);
  }
}

// ---------------- briefing / composer ----------------
function renderBriefing(event, state) {
  $("consequenceView").classList.add("hidden");
  $("briefingView").classList.remove("hidden");
  $("monthChip").textContent = "Month " + state.month + " of 48";
  $("eventTitle").textContent = event.title;
  $("eventBrief").textContent = event.brief;
  const input = $("policyInput");
  input.value = "";
  $("publicMessage").value = "";
  updateCharCount();
  input.oninput = updateCharCount;
  $("enactBtn").onclick = submitPolicy;
  input.focus();
}
function updateCharCount() {
  const n = $("policyInput").value.length;
  $("charCount").textContent = n + " / 1600";
}

async function submitPolicy() {
  const policy = $("policyInput").value.trim();
  if (policy.length < 3) {
    $("policyInput").focus();
    $("policyInput").style.borderColor = "var(--bad)";
    setTimeout(() => ($("policyInput").style.borderColor = ""), 900);
    return;
  }
  const publicMessage = $("publicMessage").value.trim();
  loader(true, G.meta.ai ? "Advisors and agencies are war-gaming your decision…" : "The consequences are unfolding…");
  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: G.state, event: G.event, policy, publicMessage }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const prevApproval = G.state.approval;
    G.state = data.state;
    G.pendingEvent = data.result.nextEvent;
    renderDashboard(G.state, G.state.approval - prevApproval);
    renderConsequences(data.result, policy);
  } catch (err) {
    alert("The turn could not be resolved: " + err.message);
  } finally {
    loader(false);
  }
}

// ---------------- consequences ----------------
function renderConsequences(result, policy) {
  $("briefingView").classList.add("hidden");
  const view = $("consequenceView");
  view.classList.remove("hidden");
  view.innerHTML = "";

  const block = el("div", "result-block");

  const dc = result.approvalChange || 0;
  const dcCls = dc > 0.05 ? "up" : dc < -0.05 ? "down" : "";
  block.appendChild(el("div", "result-head", `
    <h2>The Verdict</h2>
    <span class="big-delta ${dcCls}">${dc > 0 ? "+" : ""}${dc.toFixed(1)} approval</span>`));

  block.appendChild(el("div", "briefing",
    `<span class="kicker">West Wing Briefing</span>${escapeHtml(result.analysis || "")}`));

  // Press
  if (result.press?.length) {
    block.appendChild(el("div", "section-title", "The Morning Front Pages"));
    const grid = el("div", "press-grid");
    for (const p of result.press) {
      const lean = ["left", "center", "right"].includes(p.lean) ? p.lean : "center";
      grid.appendChild(el("div", "press " + lean,
        `<div class="outlet">${escapeHtml(p.outlet || "")}</div><div class="hl">${escapeHtml(p.headline || "")}</div>`));
    }
    block.appendChild(grid);
  }

  // Personas
  if (result.personas?.length) {
    block.appendChild(el("div", "section-title", "Focus Group — Voices from the Country"));
    const grid = el("div", "persona-grid");
    for (const p of result.personas) {
      const mood = ["approve", "disapprove", "mixed"].includes(p.mood) ? p.mood : "mixed";
      grid.appendChild(el("div", "persona", `
        <div class="ptop">
          <div><div class="pname">${escapeHtml(p.name || "")}</div><div class="pgroup">${escapeHtml(p.group || "")}</div></div>
          <span class="mood-pill ${mood}">${mood}</span>
        </div>
        <div class="quote">“${escapeHtml(p.quote || "")}”</div>`));
    }
    block.appendChild(grid);
  }

  // Stakeholder shifts
  if (result.stakeholders?.length) {
    const shifts = result.stakeholders.filter((s) => Math.abs(s.change || 0) >= 1);
    if (shifts.length) {
      block.appendChild(el("div", "section-title", "Stakeholder Reactions"));
      const grid = el("div", "shift-grid");
      for (const s of shifts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))) {
        const c = s.change > 0 ? "up" : s.change < 0 ? "down" : "flat";
        grid.appendChild(el("div", "shift",
          `<span>${escapeHtml(s.name || "")}</span><span class="sc ${c}">${s.change > 0 ? "+" : ""}${s.change}</span>`));
      }
      block.appendChild(grid);
    }
  }

  // Continue
  const wrap = el("div", "continue-wrap");
  if (G.state.over) {
    const btn = el("button", "btn primary big", "See Your Legacy →");
    btn.style.maxWidth = "300px";
    btn.onclick = () => renderGameOver(G.state);
    wrap.appendChild(btn);
  } else {
    const btn = el("button", "btn primary", `Continue to Month ${G.state.month} →`);
    btn.onclick = continueToNext;
    wrap.appendChild(btn);
  }
  block.appendChild(wrap);

  view.appendChild(block);
  $("mainScroll").scrollTop = 0;
}

function continueToNext() {
  G.event = G.pendingEvent || { title: "A Quiet Month", brief: "No single crisis dominates the news, giving you rare room to set your own agenda. What will you push?" };
  renderBriefing(G.event, G.state);
  $("mainScroll").scrollTop = 0;
}

// ---------------- game over ----------------
function renderGameOver(state) {
  const inner = $("overInner");
  const end = state.ending || { type: "narrow", reason: "Your term has ended." };
  const seal = { reelected: "🏆", narrow: "⚖️", defeated: "🗳️", removed: "⛓️", collapse: "💥" }[end.type] || "🏛️";
  const cls = ["reelected"].includes(end.type) ? "win" : ["defeated", "removed", "collapse"].includes(end.type) ? "lose" : "mixed";
  const titleText = {
    reelected: "Re-elected",
    narrow: "Too Close to Call",
    defeated: "Voted Out",
    removed: "Removed from Office",
    collapse: "The Government Falls",
  }[end.type] || "Your Presidency Ends";

  const peak = Math.max(state.approval, ...state.history.map((h) => h.approval));
  const rows = [
    ["President", state.scenario.presidentName],
    ["Months served", (state.month - 1) + " of 48"],
    ["Final approval", Math.round(state.approval) + "%"],
    ["Peak approval", Math.round(peak) + "%"],
    ["Final economy", `${state.economy.gdpGrowth.toFixed(1)}% GDP · ${state.economy.unemployment.toFixed(1)}% unemp.`],
    ["Electoral votes (favorable)", electoralFavorable(state)],
  ];

  const timeline = state.history.slice(-8).map((h) =>
    `<div class="tl-item"><span class="tlm">Month ${h.month}</span><span>${escapeHtml(h.headline || "—")} <b style="color:${h.approvalChange >= 0 ? "var(--good)" : "var(--bad)"}">(${h.approvalChange >= 0 ? "+" : ""}${h.approvalChange})</b></span></div>`
  ).join("");

  inner.innerHTML = `
    <div class="over-seal">${seal}</div>
    <h1 class="over-title ${cls}">${titleText}</h1>
    <p class="over-reason">${escapeHtml(end.reason)}</p>
    <div class="legacy">
      <h3>The Historical Record</h3>
      ${rows.map((r) => `<div class="legacy-row"><span class="lk">${r[0]}</span><span>${r[1]}</span></div>`).join("")}
      <div class="timeline"><h3 style="margin-top:18px">Final Chapters</h3>${timeline || "<div class='tl-item'>—</div>"}</div>
    </div>
    <button class="btn primary big" id="againBtn" style="max-width:320px">Begin a New Career</button>`;
  $("againBtn").onclick = () => location.reload();
  show("gameover");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
