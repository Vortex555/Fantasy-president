"use strict";

import { $, show, escapeHtml, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { houseVerdict } from "../api.js";

/**
 * What the House remembers.
 *
 * A member's career used to close on the presidential legacy screen, which told
 * them they had been President, served twenty-three months of forty-eight, and
 * won no electoral votes. This is the record they actually made: the seat, the
 * votes, the bills, the gavel, and whose side they took when it cost them.
 */

export async function renderHouseLegacy(onCareers) {
  const state = G.state;
  saveCareer();

  loader(true, "The Congressional Record is being closed…");
  let v;
  try {
    v = await houseVerdict(state);
  } catch (err) {
    alert("The record could not be written: " + err.message);
    return onCareers();
  } finally {
    loader(false);
  }

  const record = state.voteLog || [];
  const withDistrict = record.filter((r) => r.withDistrict).length;
  const withParty = record.filter((r) => r.withParty).length;
  const sponsored = state.sponsored || [];
  const buried = (state.committeeLog || []).filter((e) => e.action === "buried");
  const impeachment = record.find((r) => r.impeachment);

  $("legacyBody").innerHTML = `
    <div class="panel">
      <div class="legacy__seal">${v.ending.seal}</div>
      <h1 class="display display--xl legacy__title ${v.ending.cls}">${escapeHtml(v.ending.label)}</h1>
      <p class="legacy__reason">${escapeHtml(state.ending?.reason
        || `${v.terms} term${v.terms === 1 ? "" : "s"} representing ${v.district}.`)}</p>

      <div class="card verdict">
        <span class="eyebrow">🏛️ What the ${escapeHtml(v.chamberName || "House")} remembers</span>
        <div class="verdict__head">
          <div>
            <div class="verdict__rank">${escapeHtml(v.title)}</div>
            <p class="verdict__summary">${escapeHtml(v.summary)}</p>
          </div>
          <div class="verdict__score"><b>${v.score}</b><span>/100</span></div>
        </div>
        ${v.findings.length ? `<div class="verdict__findings">
          ${v.findings.map((f) => `<div class="finding finding--${
            f.good === true ? "good" : f.good === false ? "bad" : "note"}">${escapeHtml(f.text)}</div>`).join("")}
        </div>` : ""}
      </div>

      <div class="card">
        <span class="eyebrow">📜 The record</span>
        <div style="margin-top:12px">
          ${[
            ["Seat", `${v.district} · ${v.stateName}`],
            ["Party", escapeHtml(state.scenario.party) + (state.independent ? ` (caucused ${escapeHtml(state.caucus)})` : "")],
            ["Terms served", `${v.terms} · ${v.years} years`],
            ...(v.senate ? [["Filibusters", `${(state.filibusters || []).length}`]] : []),
            ["Rose to", v.rank + (v.committee ? ` · ${v.committee}` : "")],
            ["Votes cast", `${record.length}`],
            [`With your ${v.seatWord || "district"}`, `${withDistrict}${record.length ? ` of ${record.length}` : ""}`],
            ["With your caucus", `${withParty}${record.length ? ` of ${record.length}` : ""}`],
            ["Bills filed", `${sponsored.length}`],
            ["Bills passed into law", `${v.passed}`],
            ["Killed in your committee", `${buried.length}`],
            ["Final standing at home", `${Math.round(state.approval)}%`],
            ["Final standing in the caucus", `${Math.round(state.leadership)}%`],
          ].map(([k, val]) => `<div class="record__row"><span>${k}</span><b>${val}</b></div>`).join("")}
        </div>
      </div>

      ${impeachment ? `<div class="card card--alarm">
        <span class="eyebrow">⚖️ The vote you are remembered for</span>
        <p style="margin:10px 0 0">
          You voted <b>${impeachment.vote === "abstain" ? "on nothing"
            : impeachment.vote === "yes" ? "to impeach" : "to acquit"}</b>
          in ${escapeHtml(impeachment.title.replace("Impeachment of ", ""))}
          — ${impeachment.withParty ? "with your caucus" : "against your caucus"},
          ${impeachment.withDistrict ? "and with your district" : "and against your district"}.
        </p>
      </div>` : ""}

      ${sponsored.length ? `<div class="card">
        <span class="eyebrow">✒️ Bills with your name on them</span>
        <div style="margin-top:12px">
          ${sponsored.slice(0, 10).map((b) => `
            <div class="timeline__item">
              <span class="timeline__when">${b.passed ? "Law" : b.reachedFloor ? "Failed" : "Committee"}</span>
              <span class="timeline__what">${escapeHtml(b.title)}
                <b style="color:${b.passed ? "var(--green)" : "var(--faint)"}">${b.passed ? "✓" : "—"}</b></span>
            </div>`).join("")}
        </div>
      </div>` : ""}

      ${buried.length ? `<div class="card">
        <span class="eyebrow">🪦 Killed in committee</span>
        <p class="hint" style="margin:6px 0 12px">No roll call, no record, nothing to defend.</p>
        <div class="flips">
          ${buried.slice(0, 12).map((b) => `<span class="flip flip--loss">${escapeHtml(b.title)}</span>`).join("")}
        </div>
      </div>` : ""}

      <button class="btn btn--primary btn--block" id="backToCareers" style="margin-top:22px">
        ← Back to Your Careers
      </button>
    </div>`;

  $("backToCareers").onclick = onCareers;
  show("legacy");
  window.scrollTo(0, 0);
}
