"use strict";

import { $, escapeHtml, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { actOnBill } from "../api.js";

/**
 * Bills on your desk.
 *
 * Every bill here already passed both chambers, so the vote tally is not a
 * prediction — it is what happened. What matters on this card is the second
 * number: how close that margin is to two thirds, because that is the margin
 * that decides whether a veto holds or humiliates you.
 */

const marginTone = (roll) =>
  roll.yes >= roll.overrideThreshold ? "var(--red)"
    : roll.yes >= roll.overrideThreshold - 12 ? "var(--amber)"
    : "var(--green)";

function tally(label, roll) {
  const short = roll.overrideThreshold - roll.yes;
  return `<div class="bill__tally">
    <span class="bill__chamber">${label}</span>
    <span class="bill__votes">${roll.yes}–${roll.no}</span>
    <span class="bill__margin" style="color:${marginTone(roll)}">${
      short <= 0 ? "veto-proof" : `${short} short of an override`}</span>
  </div>`;
}

function billCard(bill) {
  const vetoProof = bill.house.yes >= bill.house.overrideThreshold
    && bill.senate.yes >= bill.senate.overrideThreshold;

  return `<div class="bill${bill.fringe ? " bill--fringe" : ""}">
    <div class="bill__head">
      <div>
        <div class="bill__title">${escapeHtml(bill.title)}</div>
        <div class="bill__sponsor">Sponsored by ${escapeHtml(bill.sponsor)}${
          bill.sponsorIdeology ? ` · ${escapeHtml(bill.sponsorIdeology)}` : ""}</div>
      </div>
      ${vetoProof ? `<span class="badge badge--red">Veto-proof</span>` : ""}
    </div>
    <p class="bill__brief">${escapeHtml(bill.brief)}</p>
    <div class="bill__tallies">
      ${tally("House", bill.house)}
      ${tally("Senate", bill.senate)}
    </div>
    <div class="btn-row bill__actions">
      <button class="btn btn--primary btn--sm" data-bill="${escapeHtml(bill.id)}" data-act="sign">Sign it</button>
      <button class="btn btn--danger btn--sm" data-bill="${escapeHtml(bill.id)}" data-act="veto">Veto</button>
      <span class="hint">Unsigned for three months and it expires on your desk.</span>
    </div>
  </div>`;
}

export function billsCard(state) {
  if (state.congressDissolved) return "";
  const bills = state.bills || [];

  if (!bills.length) {
    return `<div class="card">
      <div class="card__head">
        <span class="eyebrow">📜 Bills on your desk</span>
        <span class="hint">Quiet on the Hill</span>
      </div>
      <p class="hint" style="margin:0">${state.month <= 1
        ? "Congress is still finding its feet. Bills will start arriving once the term is under way."
        : "Nothing has cleared both chambers this month."}</p>
    </div>`;
  }

  return `<div class="card" id="billsCard">
    <div class="card__head">
      <span class="eyebrow">📜 Bills on your desk</span>
      <span class="hint">${bills.length} awaiting your signature</span>
    </div>
    <div class="bills">${bills.map(billCard).join("")}</div>
  </div>`;
}

export function wireBills(root, refresh) {
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-bill]");
    if (!btn) return;

    const { bill: billId, act } = btn.dataset;
    const bill = (G.state.bills || []).find((b) => b.id === billId);
    if (!bill) return;

    if (act === "veto") {
      const vetoProof = bill.house.yes >= bill.house.overrideThreshold
        && bill.senate.yes >= bill.senate.overrideThreshold;
      const warning = vetoProof
        ? `\n\nBoth chambers passed this by more than two thirds. The veto will be overridden and it will be law anyway — the only thing you gain is the fight.`
        : "";
      if (!confirm(`Veto the ${bill.title}?${warning}`)) return;
    }

    loader(true, act === "sign" ? "Signing…" : "Congress is moving to override…");
    try {
      const res = await actOnBill(G.state, billId, act);
      if (res.rejected) return alert(res.note);
      G.state = res.state;
      saveCareer();
      alert(res.note);
      refresh();
    } catch (err) {
      alert("The bill could not be acted on: " + err.message);
    } finally {
      loader(false);
    }
  });
}
