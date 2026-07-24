"use strict";

const G = {
  meta: null,
  state: null,
  event: null,        // current situation awaiting a policy
  pendingEvent: null, // next month's event, revealed on "continue"
  party: "Independent",
  chats: {},          // per-advisor conversation history
  currentAdvisor: null,
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
  wireChat();
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
    G.chats = {};
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
  renderCourt(state);
  renderArcs(state);
  renderMap(state);
}

// ---------------- ongoing situations (arcs) ----------------
const ARC_DOMAIN_LABELS = {
  economy: "Economy", security: "National Security", justice: "Law & Justice",
  social: "Society", foreign: "Foreign Affairs", health: "Health & Environment",
};

const liveArcs = (state) =>
  (state.arcs || []).filter((a) => a.status === "active" || a.status === "detonated")
    .sort((a, b) => b.severity - a.severity);
const scarArcs = (state) => (state.arcs || []).filter((a) => a.status === "scarred");

function severityMeter(severity) {
  return [1, 2, 3, 4, 5].map((i) => `<i class="${i <= severity ? "on" : ""}"></i>`).join("");
}

function renderArcs(state) {
  const list = $("arcList");
  const live = liveArcs(state);
  const scars = scarArcs(state);
  $("arcCount").textContent = live.length ? `${live.length} open` : "";
  list.innerHTML = "";

  if (!live.length && !scars.length) {
    list.appendChild(el("div", "arc-empty", "Nothing carried over — your desk is clear."));
    return;
  }

  for (const a of live) {
    const detonated = a.status === "detonated";
    const row = el("div", `arc sev${a.severity}${detonated ? " detonated" : ""}`, `
      <div class="arc-top">
        <span class="arc-title">${escapeHtml(a.title)}</span>
        <span class="arc-sev">${detonated ? "⚠" : a.severity + "/5"}</span>
      </div>
      <div class="arc-meter">${severityMeter(a.severity)}</div>
      <div class="arc-meta">${ARC_DOMAIN_LABELS[a.domain] || "—"}${a.monthsActive ? ` · ${a.monthsActive} mo.` : ""}</div>`);
    row.title = a.brief || "";
    list.appendChild(row);
  }

  for (const a of scars) {
    list.appendChild(el("div", "arc scarred", `
      <div class="arc-top"><span class="arc-title">${escapeHtml(a.title)}</span><span class="arc-sev">scar</span></div>
      <div class="arc-meta">Permanent damage · ${ARC_DOMAIN_LABELS[a.domain] || "—"}</div>`));
  }
}

function renderCourt(state) {
  const bar = $("courtBar");
  bar.innerHTML = "";
  const { conservative, liberal } = state.court;
  for (let i = 0; i < conservative; i++) bar.appendChild(el("div", "court-seat con"));
  for (let i = 0; i < liberal; i++) bar.appendChild(el("div", "court-seat lib"));
  const label = conservative >= liberal
    ? `${conservative}–${liberal} conservative majority`
    : `${liberal}–${conservative} liberal majority`;
  $("courtLabel").textContent = label;
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
const ROLE_SHORT = {
  vp: "Vice President", spouse: "First Spouse", chief: "Chief of Staff",
  state: "Sec. of State", defense: "Sec. of Defense", treasury: "Sec. of Treasury",
  ag: "Attorney General", press: "Press Secretary",
};

function renderAdvisorChips() {
  const wrap = $("advisorChips");
  wrap.innerHTML = "";
  for (const a of G.state.cabinet) {
    const chip = el("button", "advisor-chip",
      `<span class="ce">${a.emoji}</span><span>${ROLE_SHORT[a.id] || a.role} <span class="cr">· ${escapeHtml(a.name.split(" ")[0])}</span></span>`);
    chip.type = "button";
    chip.onclick = () => openChat(a.id);
    wrap.appendChild(chip);
  }
}

function openChat(advisorId) {
  G.currentAdvisor = advisorId;
  const a = G.state.cabinet.find((x) => x.id === advisorId);
  $("chatEmoji").textContent = a.emoji;
  $("chatName").textContent = a.name;
  $("chatRole").textContent = a.role;
  renderChatStats(a);
  const fireBtn = $("chatFire");
  fireBtn.classList.toggle("hidden", a.id === "spouse");
  $("chatModal").classList.remove("hidden");
  renderChatLog(advisorId);
  const input = $("chatInput");
  input.value = "";
  input.focus();
}
function closeChat() { $("chatModal").classList.add("hidden"); }

function renderChatStats(a) {
  const stats = $("chatStats");
  const bar = (label, v) => {
    const color = v >= 65 ? "var(--good)" : v >= 45 ? "var(--gold)" : "var(--bad)";
    return `<div class="stat-mini"><label>${label}<span style="color:${color}">${v}</span></label>
      <div class="track"><div class="fill" style="width:${v}%;background:${color}"></div></div></div>`;
  };
  stats.innerHTML = bar("Loyalty", a.loyalty) + bar("Competence", a.competence);
}

async function fireCurrentAdvisor() {
  const id = G.currentAdvisor;
  const a = G.state.cabinet.find((x) => x.id === id);
  if (!a || a.id === "spouse") return;
  if (!confirm(`Dismiss ${a.name} as ${a.role}? A replacement will be sworn in, but firing carries a political cost and can rattle the rest of your cabinet.`)) return;
  $("chatFire").disabled = true;
  try {
    const res = await fetch("/api/cabinet/order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: G.state, advisorId: id, action: "fire" }),
    }).then((r) => r.json());
    if (res.error || res.rejected) { alert(res.error || res.note); return; }
    G.state = res.state;
    G.chats[id] = []; // new person, fresh conversation
    const nu = G.state.cabinet.find((x) => x.id === id);
    $("chatName").textContent = nu.name;
    renderChatStats(nu);
    G.chats[id].push({ role: "advisor", text: `${nu.name} here. ${nu.name.split(" ")[0]} reporting for duty as your new ${nu.role}. What do you need?` });
    renderChatLog(id);
    renderDashboard(G.state, null);
    renderAdvisorChips();
  } catch {
    alert("The order could not be carried out.");
  } finally {
    $("chatFire").disabled = false;
  }
}

function renderChatLog(id) {
  const log = $("chatLog");
  log.innerHTML = "";
  const msgs = G.chats[id] || [];
  if (!msgs.length) {
    const a = G.state.cabinet.find((x) => x.id === id);
    log.appendChild(el("div", "chat-hint", `${escapeHtml(a.name)}, your ${escapeHtml(a.role)}, is ready. Ask about ${escapeHtml(a.focus)} — their advice reflects their loyalty and competence.`));
  }
  for (const m of msgs) {
    log.appendChild(el("div", "bubble " + (m.role === "advisor" ? "advisor" : "me"), escapeHtml(m.text)));
  }
  log.scrollTop = log.scrollHeight;
}

async function sendChat() {
  const id = G.currentAdvisor;
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text || !id) return;
  G.chats[id] = G.chats[id] || [];
  const priorHistory = G.chats[id].slice();
  G.chats[id].push({ role: "me", text });
  input.value = "";
  renderChatLog(id);

  const log = $("chatLog");
  const typing = el("div", "bubble advisor typing", "…");
  log.appendChild(typing);
  log.scrollTop = log.scrollHeight;
  $("chatSend").disabled = true;
  try {
    const res = await fetch("/api/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: G.state, event: G.event, advisorId: id, history: priorHistory, message: text }),
    }).then((r) => r.json());
    G.chats[id].push({ role: "advisor", text: res.reply || res.error || "…" });
  } catch {
    G.chats[id].push({ role: "advisor", text: "(The line dropped — try again.)" });
  } finally {
    $("chatSend").disabled = false;
    renderChatLog(id);
    input.focus();
  }
}

function wireChat() {
  $("chatClose").onclick = closeChat;
  $("chatFire").onclick = fireCurrentAdvisor;
  $("chatModal").addEventListener("click", (e) => { if (e.target.id === "chatModal") closeChat(); });
  $("chatSend").onclick = sendChat;
  $("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChat(); });
}

function renderBriefing(event, state) {
  $("consequenceView").classList.add("hidden");
  $("briefingView").classList.remove("hidden");
  $("monthChip").textContent = "Month " + state.month + " of 48";
  $("eventTitle").textContent = event.title;
  $("eventBrief").textContent = event.brief;
  $("eventCard").classList.toggle("detonated", Boolean(event.detonated));
  renderArcStrip(state, event);
  renderAdvisorChips();
  const input = $("policyInput");
  input.value = "";
  $("publicMessage").value = "";
  updateCharCount();
  input.oninput = updateCharCount;
  $("enactBtn").onclick = submitPolicy;
  input.focus();
}
// The urgent-vs-important choice, made visible: the fresh crisis is above, and
// everything still festering is right here next to it.
function renderArcStrip(state, event) {
  const strip = $("arcStrip");
  const live = liveArcs(state).filter((a) => a.id !== event?.fromArc);
  if (!live.length) {
    strip.classList.add("hidden");
    strip.innerHTML = "";
    return;
  }
  strip.classList.remove("hidden");
  strip.innerHTML = "";
  strip.appendChild(el("div", "strip-head",
    "Still on your desk — you can spend this month on one of these instead"));
  const row = el("div", "strip-row");
  for (const a of live) {
    const chip = el("div", `strip-chip sev${a.severity}`, `
      <b>${escapeHtml(a.title)}</b>
      <span>${a.severity >= 5 ? "at breaking point" : ARC_DOMAIN_LABELS[a.domain] || "—"} · ${a.monthsActive || 1} mo.</span>`);
    chip.title = a.brief || "";
    row.appendChild(chip);
  }
  strip.appendChild(row);
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

  // Checks & balances
  if (result.checks) {
    block.appendChild(el("div", "section-title", "Checks & Balances"));
    const grid = el("div", "checks-grid");
    grid.appendChild(checkCard("Congress", result.checks.congress));
    grid.appendChild(checkCard("Supreme Court", result.checks.court));
    block.appendChild(grid);
  }

  // Rollout (cabinet competence)
  if (result.rollout) {
    block.appendChild(el("div", "rollout",
      `<span class="rk">Rollout</span><span>${escapeHtml(result.rollout.name)}, your ${escapeHtml(result.rollout.role)}, ${escapeHtml(result.rollout.note)}.</span>`));
  }

  // Ongoing situations — what moved, what grew, what went off.
  if (result.arcEvents?.length) {
    block.appendChild(el("div", "section-title", "Ongoing Situations"));
    const wrap = el("div", "arc-events");
    for (const e of result.arcEvents) {
      const label = ARC_EVENT_LABELS[e.kind] || e.kind;
      wrap.appendChild(el("div", "arc-event " + e.kind, `
        <div class="ae-top">
          <span class="ae-badge ${e.kind}">${label}</span>
          <span class="ae-title">${escapeHtml(e.title || "")}</span>
          <span class="ae-meter">${severityMeter(e.severity || 0)}</span>
        </div>
        <div class="ae-detail">${escapeHtml(e.detail || "")}${e.note ? ` <span class="ae-note">${escapeHtml(e.note)}</span>` : ""}</div>`));
    }
    block.appendChild(wrap);
  }

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

  // Focus group — the whole panel reacts; a rotating cast actually speaks.
  if (result.personas?.length) {
    const all = result.personas;
    const speaking = all.filter((p) => p.quote);
    const silent = all.filter((p) => !p.quote);
    const counts = { approve: 0, mixed: 0, disapprove: 0 };
    for (const p of all) counts[p.mood] = (counts[p.mood] || 0) + 1;

    block.appendChild(el("div", "section-title", `Focus Group — ${all.length} Voters`));
    block.appendChild(el("div", "fg-summary", `
      <span class="fg-bar">
        <i class="approve" style="flex:${counts.approve || 0.0001}"></i>
        <i class="mixed" style="flex:${counts.mixed || 0.0001}"></i>
        <i class="disapprove" style="flex:${counts.disapprove || 0.0001}"></i>
      </span>
      <span class="fg-legend">
        <b class="approve">${counts.approve}</b> approve ·
        <b class="mixed">${counts.mixed}</b> mixed ·
        <b class="disapprove">${counts.disapprove}</b> disapprove
      </span>`));

    const grid = el("div", "persona-grid");
    for (const p of speaking) {
      const mood = ["approve", "disapprove", "mixed"].includes(p.mood) ? p.mood : "mixed";
      grid.appendChild(el("div", "persona", `
        <div class="ptop">
          <div><div class="pname">${escapeHtml(p.name || "")}</div><div class="pgroup">${escapeHtml(p.group || "")}</div></div>
          <span class="mood-pill ${mood}">${mood}</span>
        </div>
        <div class="quote">“${escapeHtml(p.quote || "")}”</div>`));
    }
    block.appendChild(grid);

    if (silent.length) {
      block.appendChild(el("div", "fg-rest-label", `The rest of the panel — ${silent.length} more reacting quietly`));
      const rest = el("div", "fg-rest");
      for (const p of silent) {
        const chip = el("span", "fg-chip " + p.mood, escapeHtml(p.name || ""));
        chip.title = `${p.group || ""} — ${p.mood}`;
        rest.appendChild(chip);
      }
      block.appendChild(rest);
    }
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
  } else if (G.state.phase === "campaign") {
    const btn = el("button", "btn primary big", "Enter the Campaign →");
    btn.style.maxWidth = "300px";
    btn.onclick = enterCampaign;
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

const ARC_EVENT_LABELS = {
  opened: "New", escalated: "Escalating", holding: "Unchanged", eased: "Eased",
  resolved: "Resolved", detonated: "Blew Up", scarred: "Permanent Scar",
};

const CHECK_STATUS = {
  passed:      { cls: "good", txt: "Passed Congress" },
  compromised: { cls: "warn", txt: "Watered Down" },
  blocked:     { cls: "bad",  txt: "Blocked" },
  executive:   { cls: "warn", txt: "Executive Action" },
  none:        { cls: "",     txt: "Unchallenged" },
  upheld:      { cls: "good", txt: "Upheld by the Court" },
  struck_down: { cls: "bad",  txt: "Struck Down" },
};
function checkCard(label, c) {
  const info = CHECK_STATUS[c?.status] || CHECK_STATUS.none;
  const note = c?.note || (c?.status === "none" ? "No legal challenge was mounted." : "");
  const card = el("div", "check " + info.cls,
    `<div class="ct">${label}</div><div class="cs">${info.txt}</div>${note ? `<div class="cn">${escapeHtml(note)}</div>` : ""}`);
  if (c?.tally) card.appendChild(voteTally(c.tally));
  return card;
}

function voteTally(t) {
  const wrap = el("div", "tally");
  for (const [name, ch] of [["House", t.house], ["Senate", t.senate]]) {
    const yesPct = (ch.yes / ch.total) * 100;
    const markPct = (ch.threshold / ch.total) * 100;
    const row = el("div", "tally-row", `
      <div class="tl-chamber">${name} <span><b>${ch.yes}</b>–${ch.no} ${ch.passed ? "✓ passed" : "✗ failed"}</span></div>
      <div class="tally-bar"><span class="yes" style="width:${yesPct}%"></span><span class="no" style="width:${100 - yesPct}%"></span><span class="mark" style="left:${markPct}%"></span></div>
      <div class="tl-split">Democrats ${ch.dYes} yes · Republicans ${ch.rYes} yes · ${ch.threshold} needed</div>`);
    wrap.appendChild(row);
  }
  return wrap;
}

function continueToNext() {
  G.event = G.pendingEvent || { title: "A Quiet Month", brief: "No single crisis dominates the news, giving you rare room to set your own agenda. What will you push?" };
  renderBriefing(G.event, G.state);
  $("mainScroll").scrollTop = 0;
}

// ---------------- campaign / debate ----------------
function enterCampaign() {
  const c = G.state.campaign;
  G.debate = { round: 1, scores: [], history: [] };
  $("youName").textContent = G.state.scenario.presidentName;
  $("youMeta").textContent = `${G.state.scenario.party} · ${Math.round(G.state.approval)}% approval`;
  $("oppName").textContent = c.opponent.name;
  $("oppMeta").textContent = `${c.opponent.party} challenger · ${c.opponent.style}`;
  $("debateLog").innerHTML = "";
  $("debateFinish").classList.add("hidden");
  $("debateComposer").classList.remove("hidden");
  updateScoreBar(0);
  renderDebateRound();
  const input = $("debateInput");
  input.value = "";
  input.oninput = () => { $("debateCount").textContent = input.value.length + " / 700"; };
  $("debateCount").textContent = "0 / 700";
  $("debateSend").onclick = submitDebate;
  $("finishBtn").onclick = finishCampaign;
  show("campaign");
  window.scrollTo(0, 0);
}

function renderDebateRound() {
  const topics = G.state.campaign.topics;
  const t = topics[G.debate.round - 1];
  $("debateRound").textContent = `Round ${G.debate.round} of 3 · ${t.topic}`;
  $("moderatorQ").textContent = `Moderator: “${t.q}”`;
}

function updateScoreBar(total) {
  const fill = $("scoreFill");
  const pct = Math.max(-100, Math.min(100, total * 3.3)); // ±30 → ±100%
  fill.classList.toggle("neg", pct < 0);
  if (pct >= 0) { fill.style.left = "50%"; fill.style.width = (pct / 2) + "%"; }
  else { fill.style.left = (50 + pct / 2) + "%"; fill.style.width = (-pct / 2) + "%"; }
  const label = total > 4 ? "You are winning the debate" : total < -4 ? "The challenger is winning" : "Debate momentum: even";
  $("scoreText").textContent = `${label} (${total > 0 ? "+" : ""}${total})`;
}

async function submitDebate() {
  const input = $("debateInput");
  const line = input.value.trim();
  if (line.length < 3) { input.focus(); return; }
  const topic = G.state.campaign.topics[G.debate.round - 1].topic;
  $("debateSend").disabled = true;
  loader(true, G.meta.ai ? "The challenger is firing back…" : "The room reacts…");
  try {
    const res = await fetch("/api/debate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: G.state, round: G.debate.round, topic, playerLine: line, history: G.debate.history }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);

    G.debate.scores.push(res.score || 0);
    G.debate.history.push({ role: "you", text: line });
    G.debate.history.push({ role: "opponent", text: res.opponentLine });
    renderExchange(G.debate.round, topic, line, res);

    const total = G.debate.scores.reduce((a, b) => a + b, 0);
    updateScoreBar(total);

    G.debate.round++;
    input.value = "";
    $("debateCount").textContent = "0 / 700";
    if (G.debate.round > 3) {
      $("debateComposer").classList.add("hidden");
      $("debateFinish").classList.remove("hidden");
      $("debateFinish").scrollIntoView({ behavior: "smooth" });
    } else {
      renderDebateRound();
    }
  } catch (err) {
    alert("The debate round failed: " + err.message);
  } finally {
    $("debateSend").disabled = false;
    loader(false);
  }
}

function renderExchange(round, topic, youLine, res) {
  const log = $("debateLog");
  const score = res.score || 0;
  const cls = score > 1 ? "up" : score < -1 ? "down" : "flat";
  const ex = el("div", "debate-exchange", `
    <div class="dq">Round ${round} · ${escapeHtml(topic)}</div>
    <div class="debate-turn you"><span class="who">${escapeHtml(G.state.scenario.presidentName)}:</span> ${escapeHtml(youLine)}</div>
    <div class="debate-turn opp"><span class="who">${escapeHtml(G.state.campaign.opponent.name)}:</span> ${escapeHtml(res.opponentLine || "")}</div>
    <div class="debate-pundit"><span>${escapeHtml(res.pundit || "")}</span><span class="round-score ${cls}">${score > 0 ? "+" : ""}${score}</span></div>`);
  log.appendChild(ex);
}

async function finishCampaign() {
  const total = G.debate.scores.reduce((a, b) => a + b, 0);
  loader(true, "The polls are closing. The nation votes…");
  try {
    const res = await fetch("/api/campaign/finish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: G.state, debateScore: total }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    G.state = res.state;
    renderGameOver(G.state);
  } catch (err) {
    alert("The election could not be resolved: " + err.message);
  } finally {
    loader(false);
  }
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
  const unfinished = liveArcs(state);
  const scars = scarArcs(state);
  const resolved = (state.arcs || []).filter((a) => a.status === "resolved").length;
  const rows = [
    ["President", state.scenario.presidentName],
    ["Months served", (state.month - 1) + " of 48"],
    ["Final approval", Math.round(state.approval) + "%"],
    ["Peak approval", Math.round(peak) + "%"],
    ["Final economy", `${state.economy.gdpGrowth.toFixed(1)}% GDP · ${state.economy.unemployment.toFixed(1)}% unemp.`],
    ["Electoral votes (favorable)", electoralFavorable(state)],
    ["Situations resolved", resolved],
    ["Left unresolved", unfinished.length + scars.length],
  ];

  const legacyArcs = [
    ...scars.map((a) => ({ a, cls: "scarred", tag: "permanent scar" })),
    ...unfinished.map((a) => ({ a, cls: "unfinished", tag: `still open · severity ${a.severity}/5` })),
  ];
  const arcBlock = legacyArcs.length
    ? `<div class="timeline"><h3 style="margin-top:18px">Unfinished Business</h3>${legacyArcs.map(({ a, cls, tag }) =>
        `<div class="tl-item ${cls}"><span class="tlm">${ARC_DOMAIN_LABELS[a.domain] || "—"}</span><span>${escapeHtml(a.title)} <b>(${tag})</b></span></div>`).join("")}</div>`
    : "";

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
      ${arcBlock}
    </div>
    <button class="btn primary big" id="againBtn" style="max-width:320px">Begin a New Career</button>`;
  $("againBtn").onclick = () => location.reload();
  show("gameover");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
