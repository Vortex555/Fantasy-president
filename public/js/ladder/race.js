"use strict";

import { $, show, escapeHtml, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { ladderRace } from "../api.js";

/**
 * Running for something you do not hold.
 *
 * One screen, not a set-piece: where the money goes, what you run on, and then
 * the result broken into the same factor bars every other election in the game
 * uses. The full presidential campaign — three debate rounds, fifty-one calls —
 * stays special by not being spent on every promotion.
 *
 * What the player is really reading here is the recognition gap. A career
 * arrives known to one district out of fifteen, and the war chest exists to
 * close that. Showing both numbers before they commit is the whole point.
 */

let handlers = {};
let choice = null;
let runOn = "record";
let spend = 0;

export function renderLadderRace(hooks, chosen) {
  handlers = hooks;
  choice = chosen;
  runOn = "record";
  spend = Math.min(G.career?.warChest || 0, Math.round((G.career?.warChest || 0) * 0.6));
  paintForm();
}

function paintForm() {
  const c = G.career;
  const where = choice.where;
  const stateName = where ? (G.meta?.states?.[where]?.name || where) : "the country";
  const opponent = opponentFor(choice, where);

  $("raceBody").innerHTML = `
    <div class="screen-head">
      <div>
        <h1 class="display display--xl">${escapeHtml(choice.label)}</h1>
        <p class="lede">${escapeHtml(stateName)} · ${c.year}${
          choice.collides ? " — and you cannot keep your seat and run" : ""}</p>
      </div>
    </div>

    <div class="card${choice.collides ? " card--alarm" : ""}">
      <span class="eyebrow">🎯 Who you are running against</span>
      <h3 class="display display--sm" style="margin:6px 0 4px">${escapeHtml(opponent.name)}</h3>
      <p class="hint" style="margin:0">${escapeHtml(opponent.blurb)}</p>
    </div>

    <div class="card">
      <span class="eyebrow">📊 Where you start</span>
      <div class="tiles tiles--four" style="margin-top:12px">
        ${tile("They know them", `${opponent.recognition}%`, "Name recognition")}
        ${tile("They know you", `${knownNow()}%`, where ? `Across ${escapeHtml(stateName)}` : "Nationally")}
        ${tile("The party", `${Math.round(c.standing)}`, c.standing >= 35 ? "Not fighting you" : "Has another candidate")}
        ${tile("In the bank", `$${(c.warChest || 0).toFixed(1)}M`, "Yours to commit")}
      </div>
      <p class="hint" style="margin:14px 0 0">
        A campaign is how a stranger stops being one. Most of what you spend goes on
        introducing yourself; only what is left over changes anybody's mind.
      </p>
    </div>

    <div class="card">
      <span class="eyebrow">💰 What you commit</span>
      <div class="sponsor-row" style="margin-top:12px">
        <label class="sponsor-field" style="flex:1">
          <input id="raceSpend" type="range" min="0" max="${Math.max(1, Math.floor(c.warChest || 0))}"
            value="${Math.floor(spend)}" />
          <span class="hint" id="raceSpendLabel"></span>
        </label>
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">🗣️ What you run on</span>
      <div class="opts opts--grid" data-pick="runOn" style="margin-top:12px">
        ${optionButton("record", "Your record", "Everything you voted for, read back to a bigger electorate")}
        ${optionButton("opponent", "Their record", "Make it about them, and leave your own votes alone")}
        ${optionButton("office", "The office you are leaving", "Run on the job you did, not the votes you cast")}
      </div>
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="raceGo" style="max-width:340px">
        ${choice.collides ? "Give Up Your Seat and Run →" : "Run →"}
      </button>
      <button class="btn" id="raceBack" style="max-width:340px;margin-top:10px">← Think again</button>
    </div>`;

  wireForm(opponent);
  show("race");
  window.scrollTo(0, 0);
}

const tile = (label, value, note) => `<div class="tile tile--compact">
  <div class="tile__label">${escapeHtml(label)}</div>
  <div class="tile__value">${escapeHtml(String(value))}</div>
  <div class="tile__note">${escapeHtml(note)}</div>
</div>`;

const optionButton = (value, label, sub) => `
  <button type="button" class="opt${value === runOn ? " is-selected" : ""}" data-value="${value}">
    <span class="opt__label">${escapeHtml(label)}</span>
    <span class="opt__sub">${escapeHtml(sub)}</span>
  </button>`;

/** Roughly what this electorate already knows of you, before a dollar is spent. */
function knownNow() {
  const r = G.career?.recognition || { national: 0, states: {}, districts: {} };
  if (!choice.where) return Math.round(r.national || 0);
  return Math.round(Math.max(r.states?.[choice.where] || 0, r.national || 0));
}

/**
 * Who is on the other side.
 *
 * Drawn from the world rather than invented: a statewide race is against a
 * figure the player has been watching on their own map, and the presidency is
 * against somebody the whole country knows.
 */
function opponentFor(chosen, where) {
  const stateName = where ? (G.meta?.states?.[where]?.name || where) : "the country";
  // The other side is the other side from *you*, not from the President.
  const other = G.career?.party === "Republican" ? "Democrat" : "Republican";
  if (chosen.office === "president") {
    return {
      name: `${G.state?.president?.name || "The incumbent"}'s party`,
      party: other,
      recognition: 78,
      blurb: "A national figure with a national operation. Everybody has already decided how they feel.",
    };
  }
  return {
    name: `Gov. Whitfield (${other[0]})`,
    party: other,
    recognition: 71,
    blurb: `Two terms in the statehouse and a name every household in ${stateName} knows. ` +
      `You have been watching them on your own map for years.`,
  };
}

function wireForm(opponent) {
  const range = $("raceSpend");
  const label = () => {
    spend = Number(range.value);
    $("raceSpendLabel").textContent = spend > 0
      ? `Commit $${spend}M of $${(G.career.warChest || 0).toFixed(1)}M`
      : "Commit nothing, and stay a stranger";
  };
  range.oninput = label;
  label();

  $("raceBody").querySelector('[data-pick="runOn"]').onclick = (e) => {
    const btn = e.target.closest(".opt");
    if (!btn) return;
    runOn = btn.dataset.value;
    for (const b of $("raceBody").querySelectorAll('[data-pick="runOn"] .opt')) {
      b.classList.toggle("is-selected", b.dataset.value === runOn);
    }
  };

  $("raceBack").onclick = () => handlers.onBack();
  $("raceGo").onclick = () => hold(opponent);
}

async function hold(opponent) {
  loader(true, "The polls are closing…");
  let data;
  try {
    data = await ladderRace(G.career, G.state, {
      target: choice.office,
      where: choice.where,
      opponent,
      runOn,
      collides: choice.collides,
      spend: choice.where ? { [choice.where]: spend } : { national: spend },
    });
  } catch (err) {
    alert("The race could not be run: " + err.message);
    return;
  } finally {
    loader(false);
  }

  // Whatever happens, the money is spent.
  G.career = { ...data.career, warChest: Math.max(0, (data.career.warChest || 0) - spend) };
  saveCareer();
  paintResult(data.result, opponent);
}

function paintResult(result, opponent) {
  const won = result.won;
  const bar = (label, value, note) => `<div class="factor">
    <div class="factor__head">
      <span>${escapeHtml(label)}</span>
      <b class="${value >= 0 ? "up" : "down"}">${value > 0 ? "+" : ""}${value}</b>
    </div>
    <div class="factor__track">
      <div class="factor__fill ${value >= 0 ? "is-pos" : "is-neg"}"
        style="width:${Math.min(100, Math.abs(value) * 6)}%"></div>
    </div>
    <div class="factor__note">${escapeHtml(note)}</div>
  </div>`;

  $("raceBody").innerHTML = `
    <div class="panel" style="text-align:center">
      <div class="legacy__seal">${won ? "🎉" : "📦"}</div>
      <h1 class="display display--xl legacy__title ${won ? "win" : "lose"}">
        ${won ? "Elected" : "Defeated"}</h1>
      <p class="legacy__reason">
        ${escapeHtml(opponent.name)} — by <b>${Math.abs(result.margin).toFixed(1)}</b> points.
        ${won ? "" : choice.collides
          ? "And you gave up your seat to run."
          : "You still hold what you held."}
      </p>
    </div>

    <div class="card">
      <span class="eyebrow">📊 What decided it</span>
      <div class="factors" style="margin-top:14px">
        ${bar("The ground", result.ground, "The constituency's own politics. You do not get to change this.")}
        ${bar("Do they know you", result.recognition,
          `They ended at ${Math.round(result.mine)}% to your opponent's ${result.theirs}%.`)}
        ${bar("Your record", result.record, "Every vote you ever cast, read to a bigger electorate.")}
        ${bar("Money", result.money, "What the spending bought beyond the introduction.")}
        ${bar("The establishment", result.establishment, "Whether your party cleared the field or not.")}
        ${bar("The national wave", result.wave, "The President's record, landing on everybody's race.")}
        ${result.incumbency ? bar("Incumbency", result.incumbency, "The seat you already held.") : ""}
      </div>
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="raceOn" style="max-width:340px">
        ${won ? "Take the Oath →" : choice.collides ? "Out of Office →" : "Back to Work →"}
      </button>
    </div>`;

  $("raceOn").onclick = () => handlers.onResult(result, choice);
  show("race");
  window.scrollTo(0, 0);
}
