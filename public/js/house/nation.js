"use strict";

import { $, escapeHtml } from "../util.js";
import { G } from "../store.js";
import { chamberStaff } from "../api.js";

/**
 * The two things on a member's floor that are not votes: the country they are
 * voting about, and the one person whose job is what a vote costs them.
 *
 * Both are new to the mode and both sit either side of the schedule, so they
 * live together here rather than pushing floor.js — which is already carrying
 * two chambers, impeachment, confirmations and the whip — past the point where
 * anybody can find anything in it.
 */

// --- The country you are legislating in --------------------------------------

/**
 * What the month is about.
 *
 * This is the card the mode was missing. A member's floor used to open on a
 * list of bills with no explanation of why any of them were there, because
 * there was nothing outside the chamber for them to be about — the economy was
 * four frozen numbers and the country had no problems in it. Now the schedule
 * is written out of what is on this card, so it goes above the schedule.
 *
 * The severity bars are the important part: they are what the floor is graded
 * against. A problem nobody legislates about gets worse every second month, and
 * an economic one drags the growth and unemployment figures with it.
 */
export function nationCard(nation, written) {
  if (!nation) return "";
  const e = nation.economy;
  const potus = nation.president;
  const problems = nation.problems || [];

  const econ = e ? `<div class="flips" style="margin-top:12px">
    <span class="flip">Growth<i>${e.gdpGrowth}%</i></span>
    <span class="flip">Unemployment<i>${e.unemployment}%</i></span>
    <span class="flip">Inflation<i>${e.inflation}%</i></span>
    <span class="flip">Debt<i>$${e.debt}T</i></span>
    ${potus ? `<span class="flip">President ${escapeHtml(potus.party?.[0] || "")}<i>${Math.round(potus.approval)}%</i></span>` : ""}
  </div>` : "";

  return `<div class="card">
    <div class="card__head">
      <span class="eyebrow">🌍 The country this month</span>
      ${written ? `<span class="hint">The calendar was written for it</span>` : ""}
    </div>
    ${nation.situation ? `
      <h3 class="display display--sm" style="margin:6px 0 6px">${escapeHtml(nation.situation.title)}</h3>
      <p class="brief__body" style="margin:0">${escapeHtml(nation.situation.brief || "")}</p>` : ""}
    ${econ}

    ${problems.length ? `
      <p class="hint" style="margin:16px 0 8px">
        <b>Still on the table.</b> A bill that passes here eases the one it was about;
        one that nobody schedules gets worse on its own.
      </p>
      <div class="stances" style="grid-template-columns:1fr">
        ${problems.map(problemRow).join("")}
      </div>` : `
      <p class="hint" style="margin:16px 0 0">Nothing is outstanding. It will not last.</p>`}

    ${nation.resolved?.length ? `<p class="hint" style="margin:12px 0 0">
      Settled by this Congress: ${nation.resolved.map((r) => escapeHtml(r.title)).join(" · ")}
    </p>` : ""}
    ${nation.scars?.length ? `<p class="hint" style="margin:8px 0 0">
      <b>Left until it broke open:</b> ${nation.scars.map((s) =>
        `${escapeHtml(s.title)} <i>(${s.monthsActive} months)</i>`).join(" · ")}
    </p>` : ""}
  </div>`;
}

/** One unresolved problem, with how bad it is and how long it has been ignored. */
function problemRow(p) {
  const tone = p.severity >= 4 ? "stance--no" : p.severity >= 3 ? "" : "stance--yes";
  return `<div class="stance ${tone}">
    <span class="stance__who">${escapeHtml(p.title)}</span>
    <span class="stance__pos">${escapeHtml(p.word)}</span>
    <span class="stance__note">${escapeHtml(p.brief || "")}</span>
    <span class="stance__heat">${escapeHtml(p.domain)} · severity ${p.severity}/5${
      p.ignoredStreak ? ` · ${p.ignoredStreak} month${p.ignoredStreak === 1 ? "" : "s"} untouched` : ""
    }</span>
  </div>`;
}

// --- What a vote turned out to mean ------------------------------------------

/**
 * The aftermath, once the arithmetic is out of the way.
 *
 * Everything here is written after the fact and changes nothing — the roll call
 * and both standings were settled by the engine before a word of it existed. It
 * is absent entirely when there is no model configured, and the vote reads
 * exactly as it always did.
 */
export function falloutBlock(f) {
  if (!f) return "";
  const lean = (v) => (["left", "center", "right"].includes(v) ? v : "center");
  return `
    ${f.analysis ? `<p style="margin:14px 0 0">${escapeHtml(f.analysis)}</p>` : ""}
    ${f.press?.length ? `<div class="grid-3" style="margin-top:14px">
      ${f.press.map((p) => `<div class="press press--${lean(p.lean)}">
        <div class="press__outlet">${escapeHtml(p.outlet || "")}</div>
        <div class="press__headline">${escapeHtml(p.headline || "")}</div>
      </div>`).join("")}
    </div>` : ""}
    ${f.voices?.length ? `
      <p class="hint" style="margin:16px 0 8px">🗣️ From the ${
        G.state.office === "senate" ? "state" : "district"}</p>
      <div class="stances" style="grid-template-columns:1fr">
        ${f.voices.map((v) => `<div class="stance">
          <span class="stance__who">${escapeHtml(v.name)}</span>
          <span class="stance__note">“${escapeHtml(v.quote)}”</span>
          <span class="stance__heat">${escapeHtml(v.who || "")}</span>
        </div>`).join("")}
      </div>` : ""}`;
}

// --- Your own office ---------------------------------------------------------

/** This month's conversation. A new month is a new one; last month's advice was
 *  about last month's votes. */
let staffLog = [];
let staffMonth = null;

export function resetStaffLogIfNewMonth(state) {
  const stamp = `${state.term}-${state.month}`;
  if (staffMonth === stamp) return;
  staffLog = [];
  staffMonth = stamp;
}

/**
 * The chief of staff.
 *
 * A president argues with a cabinet about what the country should do. A member
 * has one person whose job is the only question they actually get to ask, which
 * is what a vote is going to cost them — so the chat is here on the floor,
 * beside the votes, rather than behind a drawer.
 */
export function staffCard(chief) {
  if (!chief) return "";
  return `<div class="card" id="staffCard">
    <div class="card__head">
      <span class="eyebrow">☎️ ${escapeHtml(chief.name)}, your Chief of Staff</span>
      <span class="hint">${escapeHtml(chief.manner || "")}</span>
    </div>
    <div class="drawer__log" id="staffLog" style="max-height:280px;padding:14px 0">
      ${staffLog.length ? bubbles() : `<p class="hint" style="margin:0">
        They have read the whip counts and they know the district. Ask before you vote, not after.
      </p>`}
    </div>
    <div class="btn-row" style="margin-top:12px;gap:10px">
      <input id="staffInput" type="text" maxlength="400"
        placeholder="How does this play at home?" style="flex:1 1 auto" />
      <button class="btn btn--sm" id="staffGo">Ask</button>
    </div>
  </div>`;
}

export function wireStaff() {
  const input = $("staffInput");
  const go = $("staffGo");
  if (!input || !go) return;

  const ask = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.disabled = true;
    go.disabled = true;
    staffLog = [...staffLog, { role: "me", text }];
    paintStaffLog();
    try {
      const data = await chamberStaff(G.state, staffLog.slice(0, -1), text);
      staffLog = [...staffLog, { role: "staff", text: data.reply }];
    } catch (err) {
      staffLog = [...staffLog, { role: "staff", text: `The office could not be reached: ${err.message}` }];
    } finally {
      input.disabled = false;
      go.disabled = false;
      paintStaffLog();
      input.focus();
    }
  };

  go.onclick = ask;
  input.onkeydown = (e) => { if (e.key === "Enter") ask(); };
}

const bubbles = () => staffLog.map((m) => `
  <div class="bubble bubble--${m.role === "staff" ? "them" : "me"}">${escapeHtml(m.text)}</div>
`).join("");

/** Repaint the conversation alone; repainting the floor would lose the votes. */
function paintStaffLog() {
  const log = $("staffLog");
  if (!log) return;
  log.innerHTML = bubbles();
  log.scrollTop = log.scrollHeight;
}
