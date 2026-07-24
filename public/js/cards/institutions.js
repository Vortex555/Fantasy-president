"use strict";

import { $, el, escapeHtml, track, toneFor, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { institutionCandidates, appointOfficial, dismissOfficial } from "../api.js";

/**
 * Institutional positions. A seat is one of three things — held, expiring, or
 * empty — and the card says which at a glance: an empty chair is red and asks
 * to be filled, a seat with months left shows the clock running down.
 */

const term = (inst) => G.meta.institutions.find((i) => i.id === inst) || {};

function seatCard(inst, seat) {
  if (!seat) return "";
  if (seat.vacant) {
    return `<div class="post post--vacant">
      <span class="post__title">${escapeHtml(inst.title)}</span>
      <div class="post__name post__name--vacant">Vacant</div>
      <p class="post__note">${escapeHtml(inst.vacancyNote)}</p>
      <button class="btn btn--sm btn--blue" data-appoint="${inst.id}">Appoint →</button>
    </div>`;
  }

  const h = seat.holder;
  const pct = Math.round((seat.monthsRemaining / (inst.term || 48)) * 100);
  const urgent = seat.monthsRemaining <= 6;
  return `<div class="post${urgent ? " post--expiring" : ""}">
    <div class="post__head">
      <span class="post__title">${escapeHtml(inst.title)}</span>
      <button class="btn btn--sm btn--danger" data-dismiss="${inst.id}">Dismiss</button>
    </div>
    <div class="post__name">${escapeHtml(h.name)}</div>
    <div class="post__stats">
      <span title="Competence">C:<b>${h.competence}</b></span>
      <span title="Loyalty to you">L:<b>${h.loyalty}</b></span>
      <span title="Independence">I:<b>${h.independence}</b></span>
    </div>
    <div class="post__term">${seat.monthsRemaining} mo remaining${seat.appointedByYou ? " · your appointee" : ""}</div>
    ${track(pct, urgent ? "var(--red)" : "var(--blue)")}
  </div>`;
}

export function institutionsCard(state) {
  if (!state.institutions || !G.meta.institutions?.length) return "";
  const vacancies = G.meta.institutions.filter((i) => state.institutions[i.id]?.vacant).length;

  return `<div class="card" id="institutionsCard">
    <div class="card__head">
      <span class="eyebrow">🏛️ Institutional positions</span>
      <span class="hint">${vacancies ? `${vacancies} vacant` : "Fully staffed"}</span>
    </div>
    <div class="posts">
      ${G.meta.institutions.map((inst) => seatCard(inst, state.institutions[inst.id])).join("")}
    </div>
  </div>`;
}

/** The shortlist modal: three nominees, three different bargains. */
async function openShortlist(institutionId, refresh) {
  const inst = term(institutionId);
  loader(true, "Assembling a shortlist…");
  let candidates;
  try {
    ({ candidates } = await institutionCandidates(G.state, institutionId));
  } catch (err) {
    alert("Could not assemble a shortlist: " + err.message);
    return;
  } finally {
    loader(false);
  }

  const modal = el("div", "drawer", `
    <div class="drawer__box">
      <div class="drawer__head">
        <div>
          <div class="drawer__name">Appoint a ${escapeHtml(inst.title)}</div>
          <div class="drawer__role">${escapeHtml(inst.remit)}</div>
        </div>
        <button class="close-x" data-close aria-label="Close">✕</button>
      </div>
      <div class="drawer__log">
        ${candidates.map((c) => `
          <button class="mate" data-candidate="${escapeHtml(c.key)}">
            <span class="row__body">
              <span class="mate__name">${escapeHtml(c.name)}</span>
              <span class="mate__bio">${escapeHtml(c.pitch)}</span>
            </span>
            <span class="mate__stats">
              C: <b>${c.competence}</b><br />L: <b>${c.loyalty}</b><br />I: <b>${c.independence}</b><br />
              <span class="hint">${c.confirmOdds}% to confirm</span>
            </span>
          </button>`).join("")}
      </div>
    </div>`);

  document.body.appendChild(modal);
  const close = () => modal.remove();

  modal.addEventListener("click", async (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) return close();
    const pick = e.target.closest("[data-candidate]");
    if (!pick) return;

    close();
    loader(true, "The Senate is voting…");
    try {
      const res = await appointOfficial(G.state, institutionId, pick.dataset.candidate);
      G.state = res.state;
      saveCareer();
      alert(res.note);
      refresh();
    } catch (err) {
      alert("The nomination failed: " + err.message);
    } finally {
      loader(false);
    }
  });
}

async function dismissSeat(institutionId, refresh) {
  const inst = term(institutionId);
  const holder = G.state.institutions[institutionId]?.holder;
  if (!holder) return;

  const warning = holder.independence >= 60
    ? `\n\n${holder.name} is widely regarded as independent. Removing them will be read as exactly what it is, and the cost will be severe.`
    : "";
  if (!confirm(`Dismiss ${holder.name} as ${inst.title}?${warning}`)) return;

  loader(true, "The letter is being delivered…");
  try {
    const res = await dismissOfficial(G.state, institutionId);
    if (res.rejected) return alert(res.note);
    G.state = res.state;
    saveCareer();
    alert(res.note);
    refresh();
  } catch (err) {
    alert("The dismissal failed: " + err.message);
  } finally {
    loader(false);
  }
}

/** Called once per dashboard render; `refresh` repaints the dashboard. */
export function wireInstitutions(root, refresh) {
  root.addEventListener("click", (e) => {
    const appoint = e.target.closest("[data-appoint]");
    if (appoint) return openShortlist(appoint.dataset.appoint, refresh);
    const dismiss = e.target.closest("[data-dismiss]");
    if (dismiss) return dismissSeat(dismiss.dataset.dismiss, refresh);
  });
}
