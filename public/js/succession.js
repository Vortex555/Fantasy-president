"use strict";

import { $, show, escapeHtml, loader, monthLabel } from "./util.js";
import { G, saveCareer } from "./store.js";
import { twentyFifthStanding, answerTwentyFifth } from "./api.js";

/**
 * Losing the office without losing the country.
 *
 * Two screens. The Twenty-Fifth Amendment is a decision — your own cabinet has
 * declared you unfit and you either fight it or you do not. The oath is the
 * consequence: whoever ends up President, the same economy and the same
 * unfinished business are still sitting on the desk in the morning.
 */

let handlers = {};

// ---------------------------------------------------------------------------
// Section 4 — the cabinet moves
// ---------------------------------------------------------------------------

export async function renderTwentyFifth(hooks) {
  handlers = hooks;
  const state = G.state;

  loader(true, "The cabinet is meeting without you…");
  let standing;
  try {
    standing = await twentyFifthStanding(state);
  } catch (err) {
    alert("The cabinet's position could not be read: " + err.message);
    return handlers.onDashboard();
  } finally {
    loader(false);
  }

  const d = standing.declaration || {};
  const signed = d.cabinetFor ?? standing.cabinetFor;
  const held = d.cabinetAgainst ?? standing.cabinetAgainst;
  const vp = escapeHtml(d.vpName || standing.vpName || "Your Vice President");

  $("successionBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">The Twenty-Fifth Amendment</h1>
        <div class="dash-head__sub">Section 4. Your own cabinet says you cannot do the job.</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${escapeHtml(monthLabel(state.month, state.scenario.startYear))}</h2>
        <div class="dash-head__sub">Approval ${Math.round(state.approval)}% · stability ${state.stability}</div>
      </div>
    </div>

    <div class="card card--alarm">
      <span class="eyebrow">✍️ The declaration</span>
      <p style="margin:10px 0 0">
        ${vp} and <b>${signed}</b> members of your cabinet have transmitted a written declaration to
        Congress that you are unable to discharge the powers and duties of the office.
        ${held} did not sign. ${vp} is already Acting President.
      </p>
      <p class="hint" style="margin:12px 0 0">
        There is no crime alleged here and no impeachment. This is the people you appointed
        deciding you cannot do the job.
      </p>
    </div>

    <div class="card">
      <span class="eyebrow">⚖️ What happens if you fight it</span>
      <p style="margin:10px 0 0">
        You transmit your own declaration that no inability exists, and you resume the powers of
        the office immediately. Congress then has to decide — and to keep ${vp} in charge it takes
        <b>two thirds of both chambers</b>. That is a far higher bar than impeachment's simple
        majority in the House, and it is why contesting is almost always right.
      </p>
      <p class="hint" style="margin:12px 0 0">
        Almost. If your own party has given up on you, two thirds is reachable — and the
        signatories will not be in your cabinet either way afterwards.
      </p>
    </div>

    <div class="btn-row" style="justify-content:center;margin-top:22px">
      <button class="btn" id="stepAside">Stand Down</button>
      <button class="btn btn--primary" id="contest">Contest It →</button>
    </div>`;

  $("contest").onclick = () => answer("contest");
  $("stepAside").onclick = () => {
    if (confirm("Stand down? The office passes to your Vice President and the career continues under them.")) {
      answer("step_aside");
    }
  };
  show("succession");
  window.scrollTo(0, 0);
}

async function answer(action) {
  loader(true, action === "contest" ? "Congress is voting…" : "The oath is being administered…");
  try {
    const data = await answerTwentyFifth(G.state, action);
    const before = G.state.scenario.presidentName;
    G.state = data.state;
    saveCareer();
    if (data.result.sustained) return renderOath(handlers, data.result, before);
    renderSurvived(data.result);
  } catch (err) {
    alert("The declaration could not be answered: " + err.message);
  } finally {
    loader(false);
  }
}

function renderSurvived(result) {
  const purged = result.purged || [];
  const chamber = (label, v) => `<div class="result-row">
    <div><b>${label}</b><span class="result-row__sub">${v.needed} of ${v.total} needed to remove you</span></div>
    <span class="delta ${v.yes >= v.needed ? "delta--down" : "delta--up"}">${v.yes}–${v.no}</span>
  </div>`;

  $("successionBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">You Remain President</h1>
        <div class="dash-head__sub">Congress would not go along with it. Everybody watched.</div>
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">🗳️ The vote</span>
      <div style="margin-top:12px">
        ${chamber("House of Representatives", result.house)}
        ${chamber("United States Senate", result.senate)}
      </div>
      <p class="hint" style="margin:14px 0 0">
        Two thirds of both chambers were needed and neither reached it, so you resumed the powers
        of the office. The attempt is now a permanent part of your record.
      </p>
    </div>

    ${purged.length ? `<div class="card">
      <span class="eyebrow">🧹 The cabinet that signed</span>
      <p style="margin:10px 0 12px">They are gone. Their replacements are loyal, and green.</p>
      <div class="flips">
        ${purged.map((p) => `<span class="flip flip--loss">${escapeHtml(p.role)}</span>`).join("")}
      </div>
    </div>` : ""}

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="carryOn" style="max-width:340px">
        Back to the West Wing →
      </button>
    </div>`;

  $("carryOn").onclick = () => handlers.onDashboard();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// The oath
// ---------------------------------------------------------------------------

/**
 * A new president is sworn in. Shown for every route into the office —
 * conviction, resignation, collapse, or the Twenty-Fifth — because the point
 * of all of them is the same: the country did not stop.
 */
export function renderOath(hooks, result, formerName) {
  handlers = hooks;
  const state = G.state;
  const gone = (state.formerPresidents || []).slice(-1)[0];
  const name = escapeHtml(state.scenario.presidentName);
  const former = escapeHtml(formerName || gone?.name || "your predecessor");
  const arcs = (state.arcs || []).filter((a) => a.status === "active" || a.status === "detonated");
  const scars = (state.arcs || []).filter((a) => a.status === "scarred");

  $("successionBody").innerHTML = `
    <div class="panel">
      <div class="legacy__seal">📜</div>
      <h1 class="display display--xl legacy__title">${name}, President</h1>
      <p class="legacy__reason">${escapeHtml(gone?.ending?.reason || "The office has changed hands.")}</p>
    </div>

    <div class="card">
      <span class="eyebrow">🇺🇸 You are now the President</span>
      <p style="margin:10px 0 0">
        You were ${former}'s Vice President. You are playing as <b>${name}</b> from here —
        same party, your own politics, and ${state.month <= 24 ? "most" : "the rest"} of a term
        you did not campaign for.
      </p>
      <div class="tiles tiles--four" style="margin-top:16px">
        ${cell("Approval", `${Math.round(state.approval)}%`)}
        ${cell("Stability", state.stability)}
        ${cell("Months left", Math.max(0, 48 - state.month + 1))}
        ${cell("War chest", `$${Math.round(state.warChest || 0)}M`)}
      </div>
      <p class="hint" style="margin:14px 0 0">
        The country does not know you yet — your approval has reset toward the middle and the map
        has been redrawn around where <i>you</i> stand. Donors are reassessing, so half the war
        chest went with your predecessor.
      </p>
    </div>

    <div class="card">
      <span class="eyebrow">🗂️ What is still on the desk</span>
      <p style="margin:10px 0 0">
        The economy, Congress, the courts and every unfinished situation carry over untouched.
        ${arcs.length
          ? `<b>${arcs.length}</b> ongoing situation${arcs.length === 1 ? " is" : "s are"} still open`
          : "Nothing is currently festering"}${scars.length
          ? `, and <b>${scars.length}</b> permanent scar${scars.length === 1 ? "" : "s"} you did not cause`
          : ""}. The investigation into ${former}, though, does not follow the office.
      </p>
      ${arcs.length ? `<div class="flips" style="margin-top:14px">
        ${arcs.map((a) => `<span class="flip flip--loss">${escapeHtml(a.title)}<i>${a.severity}/5</i></span>`).join("")}
      </div>` : ""}
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="takeOffice" style="max-width:340px">
        Take Office →
      </button>
    </div>`;

  $("takeOffice").onclick = () => {
    G.event = null;
    handlers.onDashboard();
  };
  show("succession");
  window.scrollTo(0, 0);
}

const cell = (label, value) => `<div class="tile tile--compact">
  <div class="tile__label">${escapeHtml(label)}</div>
  <div class="tile__value">${escapeHtml(String(value))}</div>
</div>`;
