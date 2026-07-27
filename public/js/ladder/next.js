"use strict";

import { $, show, escapeHtml, loader } from "../util.js";
import { G } from "../store.js";
import { ladderChoices } from "../api.js";

/**
 * The end of a term, on the ladder.
 *
 * Everything a career can do next is listed here, including the things it
 * cannot: a rung you are too young for is shown with the reason rather than
 * omitted, because being told the Constitution says thirty is part of the game
 * and a missing option reads as a bug.
 *
 * The one thing this screen must communicate above all else is the collision —
 * whether reaching costs you the seat you are standing on. That is the decision;
 * the rest is scenery.
 */

let handlers = {};
let board = null;

export async function renderNextChoice(hooks) {
  handlers = hooks;

  loader(true, "The filing deadline approaches…");
  try {
    board = await ladderChoices(G.career, G.state);
    // The server migrates pre-ladder saves on the way in; keep what it sends.
    G.career = board.career;
  } catch (err) {
    alert("The ballot could not be read: " + err.message);
    return handlers.onFloor();
  } finally {
    loader(false);
  }

  paint();
}

function paint() {
  const c = G.career;
  const held = (c.offices || []).length;

  $("nextLede").textContent = held
    ? `${c.name} — ${held} office${held === 1 ? "" : "s"} behind you, and the ballot is open.`
    : "Your term is up. So is the rest of the ballot.";

  $("nextBody").innerHTML = `
    <div class="tiles tiles--four">
      ${tile("Known nationally", `${Math.round(c.recognition?.national || 0)}%`, "Outside your own seat")}
      ${tile("War chest", `$${(c.warChest || 0).toFixed(1)}M`, "What a campaign is bought with")}
      ${tile("The party", `${Math.round(c.standing || 50)}`, "How the establishment rates you")}
      ${tile("Age", `${c.year - c.birthYear}`, `It is ${c.year}`)}
    </div>

    <div class="rows" style="margin-top:22px">
      ${board.choices.map(choiceRow).join("")}
    </div>`;

  $("nextBody").onclick = (e) => {
    const btn = e.target.closest("[data-choice]");
    if (!btn || btn.disabled) return;
    handlers.onChoice(board.choices.find((x) => x.id === btn.dataset.choice));
  };

  show("next");
  window.scrollTo(0, 0);
}

const tile = (label, value, note) => `<div class="tile tile--compact">
  <div class="tile__label">${escapeHtml(label)}</div>
  <div class="tile__value">${escapeHtml(String(value))}</div>
  <div class="tile__note">${escapeHtml(note)}</div>
</div>`;

function choiceRow(choice) {
  const reaching = choice.id.startsWith("reach:");
  const cls = !choice.eligible ? "" : choice.collides ? " card--alarm" : reaching ? " card--accent" : "";

  const stakes = !choice.eligible
    ? escapeHtml(choice.reason)
    : choice.collides
      ? "⚠️ Same ballot as the seat you hold — you cannot be on it twice. Lose, and you hold nothing."
      : reaching
        ? "Your seat is not up this cycle. Lose, and you go back to it."
        : choice.id === "retire"
          ? "The record closes here, and history gets to say what it was."
          : "The ground you already know, and the people who already know you.";

  return `<button class="career office${cls}" data-choice="${escapeHtml(choice.id)}"
      ${choice.eligible ? "" : "disabled"}>
    <span class="office__text">
      <span class="office__title">${escapeHtml(choice.label)}</span>
      <span class="office__lede">${stakes}</span>
    </span>
    <span class="career__go">${choice.eligible ? "▸" : "✕"}</span>
  </button>`;
}
