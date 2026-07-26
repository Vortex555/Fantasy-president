"use strict";

import { $, el, show, escapeHtml, monthLabel, relativeDay } from "./util.js";
import { G, listCareers, deleteCareer, loadCareer } from "./store.js";
import { aiStatus } from "./api.js";

/** "Your Careers" — resume a run, retire one, or start fresh. */

/**
 * What a rank is called, which is not the same in both chambers: the Senate has
 * no Speaker, and its top job is Majority Leader.
 */
const RANK_LABEL = {
  house: {
    member: "Rep.", subchair: "Subcommittee Chair", chair: "Committee Chair",
    whip: "Majority Whip", speaker: "Speaker",
  },
  senate: {
    member: "Sen.", subchair: "Subcommittee Chair", chair: "Committee Chair",
    whip: "Majority Whip", speaker: "Majority Leader",
  },
};

/**
 * Which office a save is for. A member of the House and a president used to
 * render identically, which made a list of five careers unreadable.
 */
function officeLine(c) {
  if (c.office === "house" || c.office === "senate") {
    const senate = c.office === "senate";
    const rank = RANK_LABEL[c.office][c.rank] || RANK_LABEL[c.office].member;
    const seat = senate ? c.seat?.stateName : c.seat?.district;
    // Join what exists — a member with no seat recorded used to render a gap.
    return [senate ? "🏛️" : "🪑", rank, seat].filter(Boolean).map(escapeHtml).join(" ");
  }
  return "🏛️ President";
}

export function renderCareers(onResume, onNew) {
  const list = $("careerList");
  list.innerHTML = "";
  const careers = listCareers();

  if (!careers.length) {
    list.appendChild(el("div", "empty",
      "No careers yet. Start one and it will be saved here after every month you play."));
  }

  for (const c of careers) {
    const row = el("div", "row");
    const status = c.over
      ? `<span class="career__status career__status--over">Concluded</span>`
      : `<span class="career__status">Active</span>`;
    row.innerHTML = `
      <div class="row__body career">
        <div>
          <div class="career__name">${escapeHtml(c.name)}</div>
          <div class="career__meta">${officeLine(c)} · ${escapeHtml(c.scenarioName)}${
            (c.term || 1) > 1 ? ` · ${c.term} terms` : ""} · ${status} · Last played ${relativeDay(c.lastPlayed)}</div>
        </div>
        <div class="career__right">
          <span class="career__date">${monthLabel(c.month, c.startYear)}</span>
          <button class="career__delete" title="Delete this career" aria-label="Delete ${escapeHtml(c.name)}">✕</button>
        </div>
      </div>`;

    row.querySelector(".career__delete").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${c.name}'s career? This cannot be undone.`)) return;
      deleteCareer(c.id);
      renderCareers(onResume, onNew);
    });

    row.addEventListener("click", () => {
      if (loadCareer(c.id)) onResume();
    });
    list.appendChild(row);
  }

  const startNew = el("button", "row row--new", `
    <span class="row__icon">✨</span>
    <span class="row__body">
      <span class="row__title">Start a New Career</span>
      <span class="row__desc">Pick a scenario and an office — the presidency, a Senate seat,
        or one of four hundred and thirty-five in the House.</span>
    </span>
    <span class="row__chevron">▸</span>`);
  startNew.type = "button";
  startNew.addEventListener("click", onNew);
  list.appendChild(startNew);

  show("careers");
}

/**
 * Which brain is running the game.
 *
 * There are three answers and the difference matters to the player: an API they
 * are paying for, a model on their own machine that costs nothing and sends
 * nothing anywhere, or no model at all. Guessing which one is active is not
 * something anybody should have to do.
 *
 * There is a fourth answer, and it is the one this badge exists for: **a local
 * model that was configured and is not answering**. The game keeps playing on
 * the offline engine, which is correct, but it used to keep naming the model it
 * could not reach — so a whole term could be played on the built-in simulator by
 * somebody who believed their own GPU was writing it. Now the badge says so, and
 * clicking it asks the machine again.
 */
export function renderModeBadge() {
  const badge = $("modeBadge");
  const p = G.meta?.provider;
  const health = G.ai;

  // What the last real turn found out beats anything we were told at boot.
  const broken = health?.ok === false || (p?.id === "local" && p.reachable === false);

  if (broken && p?.id !== "off") {
    const why = health?.reason || p?.error || "It is not answering.";
    badge.textContent = p?.id === "local"
      ? "▲ Local model unreachable · playing offline"
      : "▲ Model unreachable · playing offline";
    badge.className = "badge badge--red badge--action";
    badge.title = `${why}\n\nMonths are being played by the built-in offline engine. ` +
      `Start your model server, then click here to re-check.`;
    wireRecheck(badge);
    return;
  }

  if (p?.id === "local" && p.available) {
    badge.textContent = `● Local model · ${p.model || "on this machine"}`;
    badge.className = "badge badge--blue badge--action";
    badge.title = `${p.detail || "Running on your own machine."}\n\nClick to re-check.`;
    wireRecheck(badge);
    return;
  }
  if (G.meta?.ai) {
    badge.textContent = "● Live AI simulation";
    badge.className = "badge badge--live";
    badge.title = p?.detail || "";
    return;
  }
  badge.textContent = "● Local simulation";
  badge.className = "badge";
  badge.title = "No model configured. Set ANTHROPIC_API_KEY, or run a model on this machine " +
    "and start with FP_PROVIDER=local.";
}

/**
 * Let the player ask again.
 *
 * The common case is a machine that was asleep when the server started. Without
 * this the only fix is restarting the server, which is not something the
 * interface ever hints at.
 */
function wireRecheck(badge) {
  badge.onclick = async () => {
    const was = badge.textContent;
    badge.textContent = "◌ checking…";
    try {
      const status = await aiStatus(true);
      G.ai = status;
      if (status.provider) G.meta = { ...G.meta, provider: status.provider, ai: status.probe?.reachable };
      renderModeBadge();
    } catch {
      badge.textContent = was;
    }
  };
}
