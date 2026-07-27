"use strict";

import { $, show, escapeHtml, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { ladderWilderness } from "../api.js";

/**
 * Out of office.
 *
 * The screen exists so that a fall is a chapter rather than an ending. Time
 * moves a year at a time, everything decays, and the four things a career
 * carries pull against each other — the choice that pays best is the one that
 * stains the record, and the one that keeps you clean is the one that lets the
 * country forget you fastest.
 */

let handlers = {};
let lastNote = null;

export function renderWilderness(hooks) {
  handlers = hooks;
  paint();
}

function paint() {
  const c = G.career;
  const w = c.wilderness || {};
  const yearsOut = Math.max(0, c.year - (w.since || c.year));

  $("wildernessLede").textContent = w.lostTo
    ? `Beaten by ${w.lostTo}. It is ${c.year}, and you hold nothing.`
    : `It is ${c.year}, and you hold nothing.`;

  $("wildernessBody").innerHTML = `
    <div class="tiles tiles--four">
      ${tile("Known nationally", `${Math.round(c.recognition?.national || 0)}%`,
        yearsOut ? `${yearsOut} year${yearsOut === 1 ? "" : "s"} of being forgotten` : "The country moves on")}
      ${tile("War chest", `$${(c.warChest || 0).toFixed(1)}M`, "Donors go where the power is")}
      ${tile("The party", `${Math.round(c.standing || 50)}`, c.standing >= 55 ? "You are owed something" : "You had your shot")}
      ${tile("Age", `${c.year - c.birthYear}`, "The clock does not stop out here")}
    </div>

    ${lastNote ? `<div class="card card--accent" style="margin-top:18px">
      <span class="eyebrow">📅 ${c.year - 1}</span>
      <p style="margin:8px 0 0">${escapeHtml(lastNote)}</p>
    </div>` : ""}

    ${c.tainted ? `<div class="card card--alarm" style="margin-top:18px">
      <span class="eyebrow">🏷️ On the record</span>
      <p style="margin:8px 0 0">You took the lobbying money. Everybody who runs against you from
        here will say so, and they will be right.</p>
    </div>` : ""}

    <div class="card" style="margin-top:18px">
      <span class="eyebrow">🕰️ What you do with the year</span>
      <p class="hint" style="margin:8px 0 14px">
        Every one of these costs you something you will want later.
      </p>
      <div class="rows" id="wildernessChoices"></div>
    </div>

    <div class="next-step">
      <button class="btn" id="wildernessQuit" style="max-width:340px">
        Retire, and let the record close →
      </button>
    </div>`;

  const rows = $("wildernessChoices");
  rows.innerHTML = CHOICES.map((c2) => `
    <button class="career office" data-year="${c2.id}">
      <span class="office__text">
        <span class="office__title">${escapeHtml(c2.label)}</span>
        <span class="office__lede">${escapeHtml(c2.note)}</span>
      </span>
      <span class="career__go">▸</span>
    </button>`).join("");

  rows.onclick = (e) => {
    const btn = e.target.closest("[data-year]");
    if (btn) passYear(btn.dataset.year);
  };
  $("wildernessQuit").onclick = () => handlers.onLegacy();

  show("wilderness");
  window.scrollTo(0, 0);
}

/**
 * Mirrors WILDERNESS_CHOICES in src/career.js. Kept here as copy rather than
 * fetched, so the screen paints before any request — the server remains the
 * authority on what each one actually does.
 */
const CHOICES = [
  { id: "lobby", label: "Take the lobbying job", note: "The money is real and so is the stain." },
  { id: "media", label: "Sign the cable news contract", note: "You stay visible, and you harden." },
  { id: "nonprofit", label: "Run a foundation", note: "Clean, and the country forgets you at full speed." },
  { id: "party", label: "Work the party circuit", note: "The establishment remembers who showed up." },
  { id: "nothing", label: "Wait", note: "Everything decays and nothing is owed to you." },
];

const tile = (label, value, note) => `<div class="tile tile--compact">
  <div class="tile__label">${escapeHtml(label)}</div>
  <div class="tile__value">${escapeHtml(String(value))}</div>
  <div class="tile__note">${escapeHtml(note)}</div>
</div>`;

async function passYear(choiceId) {
  loader(true, "The year passes…");
  try {
    const data = await ladderWilderness(G.career, choiceId);
    G.career = data.career;
    lastNote = data.note;
    saveCareer();
  } catch (err) {
    alert("The year could not pass: " + err.message);
    return;
  } finally {
    loader(false);
  }
  paint();
}
