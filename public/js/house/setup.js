"use strict";

import { $, show, escapeHtml, loader } from "../util.js";
import { houseDistricts, senateStates, statehouseSeats } from "../api.js";

/**
 * Choosing an office, and then a seat.
 *
 * The seat is the more consequential of the two and it is worth making that
 * obvious before the player picks. A safe district is a game about your party;
 * a hostile one is a game about your survival; a marginal one is a game about
 * arithmetic. The picker says so in as many words rather than making the player
 * infer it from a number.
 */

const OFFICES = [
  {
    id: "president", icon: "🏛️", title: "President of the United States",
    lede: "The office everything else in this game orbits.",
    detail: "You decide, and the country reacts. A cabinet, the courts, the states, " +
      "the world, and four years to prove it was worth handing to you.",
  },
  {
    id: "senate", icon: "🏛️", title: "United States Senator",
    lede: "One of a hundred.",
    detail: "Six-year terms, so you can take a vote your state hates and hope it is forgotten " +
      "by the time you are on the ballot — which is the only reason this chamber is capable of " +
      "doing unpopular things. Your one vote in a hundred decides real outcomes, and you can " +
      "stop the chamber on your own.",
  },
  {
    id: "statehouse", icon: "🏚️", title: "State Representative",
    lede: "Where almost every career actually starts.",
    detail: "A chamber nobody outside the state has heard of, sitting three or four months a " +
      "year for money you cannot live on. No foreign policy, no army, no printing press — and " +
      "a budget that has to balance, which is the only legislating in America that does.",
  },
  {
    id: "house", icon: "🪑", title: "Member of the House of Representatives",
    lede: "One of four hundred and thirty-five.",
    detail: "You do not decide; you vote. Leadership schedules the floor, the country sets " +
      "the weather, and the only thing that is yours is which way you go and what it costs. " +
      "Two-year terms — you are never more than eighteen months from the voters.",
  },
];

export function renderOffice(onPick, onBack) {
  $("officeBody").innerHTML = `
    <div class="rows">
      ${OFFICES.map((o) => `
        <button class="career office" data-office="${o.id}">
          <span class="office__icon">${o.icon}</span>
          <span class="office__text">
            <span class="office__title">${escapeHtml(o.title)}</span>
            <span class="office__lede">${escapeHtml(o.lede)}</span>
            <span class="office__detail">${escapeHtml(o.detail)}</span>
          </span>
          <span class="career__go">▸</span>
        </button>`).join("")}
    </div>
    <div class="btn-row" style="margin-top:22px">
      <button class="btn" id="officeBack">← Back</button>
    </div>`;

  $("officeBody").onclick = (e) => {
    const btn = e.target.closest("[data-office]");
    if (btn) onPick(btn.dataset.office);
  };
  $("officeBack").onclick = onBack;
  show("office");
}

/** "an Independent", not "a Independent". */
const article = (word) => (/^[aeiou]/i.test(String(word || "")) ? "an" : "a");

const KIND = {
  safe: {
    label: "Safe", cls: "good",
    note: "You will not lose this seat in November. The only way you go home is a primary — " +
      "and your district sits further out than your leadership does.",
  },
  marginal: {
    label: "Marginal", cls: "warn",
    note: "Decided by a point or two. Every vote is arithmetic, and both parties will spend " +
      "real money to take it off you.",
  },
  hostile: {
    label: "Hostile", cls: "bad",
    note: "This district voted for the other party and knows it. You hold it by being " +
      "personally liked and by voting against your own caucus, constantly.",
  },
};

const STATE_KIND = {
  safe: { label: "Safe", cls: "good",
    note: "Your party wins this state at the top of the ticket. You will not lose it on a bad year." },
  marginal: { label: "Marginal", cls: "warn",
    note: "A statewide coin toss every six years, and the most expensive races in the country." },
  hostile: { label: "Hostile", cls: "bad",
    note: "This state votes the other way. You hold it by being personally liked, and by six years " +
      "being long enough for a state to forget what you voted for." },
};

/** The Senate version: a whole state, and no district drawn to agree with you. */
export async function renderStates(draft, onPick, onBack) {
  loader(true, "Drawing the map…");
  let data;
  try {
    data = await senateStates(draft.party, draft.presidentName, draft.startYear);
  } catch (err) {
    alert("The map could not be drawn: " + err.message);
    return onBack();
  } finally {
    loader(false);
  }

  const group = (kind) => data.states.filter((d) => d.kind === kind);

  $("seatTitle").textContent = "Your State";
  $("seatLede").textContent =
    "Fifty states, two senators each. A statewide constituency is a very different job.";
  $("districtBody").innerHTML = `
    <p class="hint" style="margin:0 0 18px">
      A senator represents a whole state — you cannot be drawn a constituency that agrees with you.
      You are running as ${article(draft.party)} <b>${escapeHtml(draft.party)}</b>.
    </p>
    ${["safe", "marginal", "hostile"].map((kind) => `
      <div class="seat-group">
        <div class="seat-group__head">
          <span class="badge badge--${STATE_KIND[kind].cls === "good" ? "live" : STATE_KIND[kind].cls === "warn" ? "amber" : "red"}">${STATE_KIND[kind].label}</span>
          <span class="hint">${escapeHtml(STATE_KIND[kind].note)}</span>
        </div>
        <div class="rows">
          ${group(kind).map((d) => `
            <button class="career seat-row" data-seat-state="${escapeHtml(d.state)}">
              <span class="seat-row__code">${escapeHtml(d.state)}</span>
              <span class="seat-row__text">
                <span class="seat-row__name">${escapeHtml(d.stateName)}</span>
                <span class="seat-row__meta">Lean ${d.lean > 0 ? "R+" : "D+"}${Math.abs(d.lean).toFixed(1)}
                  · ${d.ev} electoral votes</span>
              </span>
              <span class="career__go">▸</span>
            </button>`).join("")}
        </div>
      </div>`).join("")}
    <div class="btn-row" style="margin-top:22px">
      <button class="btn" id="districtBack">← Back</button>
    </div>`;

  $("districtBody").onclick = (e) => {
    const btn = e.target.closest("[data-seat-state]");
    if (btn) onPick(btn.dataset.seatState);
  };
  $("districtBack").onclick = onBack;
  show("district");
  window.scrollTo(0, 0);
}

/**
 * A seat inside one state legislature.
 *
 * Two screens rather than one: which state, and then which of its districts.
 * The second is where the chamber itself is explained, because the numbers vary
 * so wildly between states that a New Hampshire seat and a California one are
 * barely the same job — 3,300 people against half a million, four hundred
 * members against eighty, $100 a year against $128,000. See statehouse.js.
 */
export async function renderStateSeats(draft, onPick, onBack) {
  loader(true, "Finding the districts…");
  let data;
  try {
    data = await statehouseSeats(draft.seatState);
  } catch (err) {
    alert("The seats could not be drawn: " + err.message);
    return onBack();
  } finally {
    loader(false);
  }

  const chamber = data.chamber;
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  $("seatTitle").textContent = "Your Seat";
  $("seatLede").textContent = "One district, in one state legislature.";
  $("districtBody").innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <span class="eyebrow">🏚️ The chamber</span>
      <p style="margin:8px 0 0">
        <b>${chamber.seats}</b> members. Terms of <b>${chamber.term}</b> years.
        It sits ${escapeHtml(months[chamber.session[0] - 1])} to ${escapeHtml(months[chamber.session[1] - 1])},
        and pays <b>${chamber.pay ? `$${chamber.pay.toLocaleString()}` : "nothing at all"}</b> a year.
      </p>
      ${chamber.unicameral ? `<p class="hint" style="margin:8px 0 0">
        Unicameral — there is no second chamber${chamber.nonpartisan
          ? ", and no party labels on the ballot either" : ""}.
      </p>` : ""}
      ${!chamber.full ? `<p class="hint" style="margin:8px 0 0">
        Part-time. Everybody in this chamber has another job, and that fact decides who can
        afford to serve in it.
      </p>` : ""}
    </div>

    <div class="rows">
      ${data.seats.map((d) => `
        <button class="career seat-row" data-state-seat="${escapeHtml(d.seat)}">
          <span class="seat-row__code">${escapeHtml(d.seat)}</span>
          <span class="seat-row__text">
            <span class="seat-row__name">${escapeHtml(STATE_KIND[d.kind]?.label || d.kind)}</span>
            <span class="seat-row__meta">Lean ${d.lean > 0 ? "R+" : "D+"}${Math.abs(d.lean).toFixed(1)}
              · about ${d.people.toLocaleString()} people</span>
          </span>
          <span class="career__go">▸</span>
        </button>`).join("")}
    </div>
    <div class="btn-row" style="margin-top:22px">
      <button class="btn" id="districtBack">← Back</button>
    </div>`;

  $("districtBody").onclick = (e) => {
    const btn = e.target.closest("[data-state-seat]");
    if (btn) onPick(btn.dataset.stateSeat);
  };
  $("districtBack").onclick = onBack;
  show("district");
  window.scrollTo(0, 0);
}

/** Pick the ground you are going to spend a career defending. */
export async function renderDistricts(draft, onPick, onBack) {
  loader(true, "Drawing the map…");
  let data;
  try {
    data = await houseDistricts(draft.party, draft.presidentName, draft.startYear);
  } catch (err) {
    alert("The map could not be drawn: " + err.message);
    return onBack();
  } finally {
    loader(false);
  }

  const group = (kind) => data.districts.filter((d) => d.kind === kind);

  $("seatTitle").textContent = "Your District";
  $("seatLede").textContent =
    "Four hundred and thirty-five seats. The one you take decides what kind of career this is.";
  $("districtBody").innerHTML = `
    <p class="hint" style="margin:0 0 18px">
      Lean is the district's own politics, not yours: negative is Democratic ground, positive
      Republican. You are running as ${article(draft.party)} <b>${escapeHtml(draft.party)}</b>.
    </p>
    ${["safe", "marginal", "hostile"].map((kind) => `
      <div class="seat-group">
        <div class="seat-group__head">
          <span class="badge badge--${KIND[kind].cls === "good" ? "live" : KIND[kind].cls === "warn" ? "amber" : "red"}">${KIND[kind].label}</span>
          <span class="hint">${escapeHtml(KIND[kind].note)}</span>
        </div>
        <div class="rows">
          ${group(kind).map((d) => `
            <button class="career seat-row" data-district="${escapeHtml(d.district)}">
              <span class="seat-row__code">${escapeHtml(d.district)}</span>
              <span class="seat-row__text">
                <span class="seat-row__name">${escapeHtml(d.stateName)}</span>
                <span class="seat-row__meta">Lean ${d.lean > 0 ? "R+" : "D+"}${Math.abs(d.lean).toFixed(1)}
                  · ${d.favour > 0 ? "friendly" : "unfriendly"} ground for ${article(draft.party)} ${escapeHtml(draft.party)}</span>
              </span>
              <span class="career__go">▸</span>
            </button>`).join("")}
        </div>
      </div>`).join("")}
    <div class="btn-row" style="margin-top:22px">
      <button class="btn" id="districtBack">← Back</button>
    </div>`;

  $("districtBody").onclick = (e) => {
    const btn = e.target.closest("[data-district]");
    if (btn) onPick(btn.dataset.district);
  };
  $("districtBack").onclick = onBack;
  show("district");
  window.scrollTo(0, 0);
}
