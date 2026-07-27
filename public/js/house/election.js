"use strict";

import { $, show, escapeHtml } from "../util.js";
import { G, saveCareer } from "../store.js";

/**
 * Election night in one district.
 *
 * The presidency counts fifty-one of these. A member counts one, and it shows
 * them the four things that actually decided it — the ground, their own
 * standing, the national wave and incumbency — because the whole point of two
 * year terms is that you can see what you did wrong in time to do it
 * differently, if there is a next time.
 */

const ordinal = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"][n] || `${n}th`;

export function renderHouseElection(hooks, result, ladder, cycle = null, choices = null) {
  const state = G.state;
  const seat = state.seat;
  const won = result.won;

  const bar = (label, value, note) => {
    const width = Math.min(100, Math.abs(value) * 3.2);
    return `<div class="factor">
      <div class="factor__head">
        <span>${escapeHtml(label)}</span>
        <b class="${value >= 0 ? "up" : "down"}">${value > 0 ? "+" : ""}${value}</b>
      </div>
      <div class="factor__track">
        <div class="factor__fill ${value >= 0 ? "is-pos" : "is-neg"}" style="width:${width}%"></div>
      </div>
      <div class="factor__note">${escapeHtml(note)}</div>
    </div>`;
  };

  const record = state.voteLog || [];
  const withDistrict = record.filter((v) => v.withDistrict).length;
  const withParty = record.filter((v) => v.withParty).length;
  const laws = (state.sponsored || []).filter((s) => s.passed).length;

  $("floorBody").innerHTML = `
    <div class="panel" style="text-align:center">
      <div class="legacy__seal">${won ? "🎉" : "📦"}</div>
      <h1 class="display display--xl legacy__title ${won ? "win" : "lose"}">
        ${won ? "Re-elected" : "Unseated"}</h1>
      <p class="legacy__reason">
        ${escapeHtml(seat.district)} — ${escapeHtml(seat.stateName)} —
        ${won ? "returned you" : "sent you home"} by
        <b>${Math.abs(result.margin).toFixed(1)}</b> points.
      </p>
    </div>

    <div class="card">
      <span class="eyebrow">📊 What decided it</span>
      <div class="factors" style="margin-top:14px">
        ${bar("The ground", result.ground, "The district's own politics. You do not get to change this.")}
        ${bar("You, personally", result.personal, `Your standing at home finished at ${Math.round(state.approval)}%.`)}
        ${bar("The national wave", result.wave, result.sameParty
          ? `You share a party with the President, so their record is yours.`
          : `The President is from the other party, which cuts your way.`)}
        ${bar("Incumbency", result.incumbency,
          `You ran as a ${ordinal(result.seniority || 1)}-term member. The longer you hold it, the harder you are to shift.`)}
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">🗂️ The record you ran on</span>
      <div class="tiles tiles--four" style="margin-top:12px">
        ${cell("Votes cast", record.length)}
        ${cell("With your district", withDistrict)}
        ${cell("With your party", withParty)}
        ${cell("Laws with your name", laws)}
      </div>
      ${record.length ? `<p class="hint" style="margin:14px 0 0">
        You broke with your caucus <b>${record.length - withParty}</b> time${record.length - withParty === 1 ? "" : "s"}
        and with your district <b>${record.length - withDistrict}</b>.
        ${withDistrict >= withParty
          ? "You chose the district more often than the party. That is how a seat like this is held."
          : "You chose the party more often than the district. That is how a career in leadership is built."}
      </p>` : ""}
    </div>

    ${cycle ? chamberCard(cycle) : ""}

    ${won && ladder ? `<div class="card${ladder.promoted ? " card--accent" : ladder.demoted ? " card--alarm" : ""}">
      <span class="eyebrow">${ladder.promoted ? "⬆️ The caucus has decided" : ladder.demoted ? "⬇️ The caucus has decided" : "🏛️ Your standing in the caucus"}</span>
      <p style="margin:10px 0 0">${escapeHtml(ladder.note)}</p>
      ${ladder.promoted ? `<p class="hint" style="margin:10px 0 0">
        This is what the party-line votes were for. Your district paid for it.
      </p>` : ""}
    </div>` : ""}

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="afterElection" style="max-width:340px">
        ${!won ? "The Record Closes →" : hooks.onNext ? "What Next? →" : `On to Term ${state.term} →`}
      </button>
    </div>`;

  $("afterElection").onclick = () => {
    saveCareer();
    if (!won) return hooks.onLegacy();
    // The ladder asks what a career does next; without one, straight back to work.
    if (hooks.onNext) return hooks.onNext();
    hooks.onFloor();
  };
  show("floor");
  window.scrollTo(0, 0);
}

const cell = (label, value) => `<div class="tile tile--compact">
  <div class="tile__label">${escapeHtml(label)}</div>
  <div class="tile__value">${escapeHtml(String(value))}</div>
</div>`;

/**
 * The other 434 races, and the third of the Senate that was up with them.
 *
 * This is the half of election night a member does not control and cannot
 * campaign in, and it decides more about the next two years than their own
 * margin does: whether their caucus schedules the floor, and whether there is a
 * gavel at the top of the ladder for anybody on their side to hold.
 */
export function chamberCard(cycle) {
  const flipped = cycle.flipped.house || cycle.flipped.senate;
  const row = (label, chamber, contested, moved) => {
    const d = cycle.congress[`${chamber}D`];
    const r = cycle.congress[`${chamber}R`];
    const side = cycle.control[chamber];
    const was = cycle.controlBefore[chamber];
    return `<div class="factor">
      <div class="factor__head">
        <span>${escapeHtml(label)} — D ${d} · R ${r}</span>
        <b class="${moved >= 0 ? "up" : "down"}">${moved > 0 ? "+" : ""}${moved}</b>
      </div>
      <div class="factor__note">
        ${escapeHtml(side)} control${side !== was ? ` — taken from the ${escapeHtml(was)}s` : ""}
        ${contested ? ` · ${contested} seats contested` : ""}
      </div>
    </div>`;
  };

  return `<div class="card${flipped ? " card--alarm" : ""}">
    <div class="card__head">
      <span class="eyebrow">🏛️ The rest of the ballot</span>
      <span class="hint">${cycle.year} ${cycle.midterm ? "midterm" : "presidential year"}</span>
    </div>
    <p style="margin:10px 0 0">${escapeHtml(cycle.note)}</p>
    <div class="factors" style="margin-top:14px">
      ${row("The House", "house", cycle.house.contested, cycle.houseSwing)}
      ${row("The Senate", "senate", cycle.senate.contested, cycle.senateSwing)}
    </div>
    <p class="hint" style="margin:14px 0 0">
      Seats shown as a swing for the President's party, which is where the national wave lands first.
      Only a third of the Senate is ever on the ballot.
    </p>
  </div>`;
}
