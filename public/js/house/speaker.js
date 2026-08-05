import { $, escapeHtml, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { speakerAction, setCalendar } from "../api.js";

/**
 * Electing a Speaker.
 *
 * The chair used to be handed over between one Congress and the next by
 * arithmetic. Nobody has ever become Speaker that way: the whole House votes,
 * by name, on the record, and a nominee needs an absolute majority of everybody
 * voting rather than a majority of their own side. The gap between those two
 * numbers is the entire screen.
 *
 * Which is why the ballots are something the player sits through rather than a
 * line in a summary. You take one, you see how far short you are, you look at
 * who is keeping you short and what they want for it, and you decide whether
 * the chair is worth the price. Every concession here is one an actual holdout
 * bloc has demanded and got, and every one of them is still in force long after
 * this screen has closed.
 */

let refresh = null;

export function speakerCard(board) {
  const race = board.speakerRace;
  if (!race || race.done) return chairCard(board);

  if (!race.nominee) {
    return `<div class="card card--alarm" id="speakerCard">
      <span class="eyebrow">🪑 The caucus met without you</span>
      <p style="margin:8px 0 0">
        Your caucus nominated ${escapeHtml(race.rival)} — ${race.nomination.votes} to your
        ${race.nomination.seats - race.nomination.votes}, and you needed ${race.nomination.needed}.
        You are not going to be Speaker of this Congress.
      </p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-speaker="withdraw">Take it and sit down</button>
      </div>
    </div>`;
  }

  const short = race.holdouts.filter((h) => !h.conceded);
  const held = short.reduce((sum, h) => sum + h.holding, 0);

  return `<div class="card card--accent" id="speakerCard">
    <span class="eyebrow">🪑 The House is electing a Speaker</span>
    <p class="hint" style="margin:6px 0 12px">
      Your caucus nominated you ${race.nomination.votes}–${race.nomination.seats - race.nomination.votes}.
      That is the easy half. On the floor you need an absolute majority of everybody voting,
      and the other party is voting for its own leader — so the only people who can keep you
      out of the chair are on your own side.
    </p>

    ${race.log.length ? `<div class="rows" style="margin-bottom:12px">
      ${race.log.slice(-4).map((line) => `<div class="career office" style="cursor:default">
        <span class="office__text"><span class="office__lede">${escapeHtml(line)}</span></span>
      </div>`).join("")}
    </div>` : ""}

    ${held ? `
      <p class="hint" style="margin:0 0 8px"><b>${held}</b> of your own members are voting for
        somebody else. Here is what they want for them.</p>
      <div class="rows">
        ${short.map((h) => `<button class="career office" data-concede="${escapeHtml(h.id)}">
          <span class="office__text">
            <span class="office__title">${escapeHtml(h.name)} — ${h.holding} votes</span>
            <span class="office__lede">Wants: ${escapeHtml(h.wants.label)}</span>
            <span class="office__lede" style="color:var(--red)">${escapeHtml(h.wants.cost)}</span>
          </span>
          <span class="career__go">Concede ▸</span>
        </button>`).join("")}
      </div>` : `<p class="hint" style="margin:0">Nobody is holding out. Take the ballot.</p>`}

    ${race.conceded.length ? `<p class="hint" style="margin:12px 0 0">
      <b>Already agreed:</b> ${race.conceded.map((c) => escapeHtml(c.label)).join("; ")}.
    </p>` : ""}

    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--primary" data-speaker="ballot">
        ${race.ballots ? `Take the ${race.ballots + 1}${ordinal(race.ballots + 1)} ballot` : "Take the first ballot"} →
      </button>
      <button class="btn btn--danger" data-speaker="withdraw">Withdraw</button>
    </div>
  </div>`;
}

const ordinal = (n) => (["th", "st", "nd", "rd"][(n % 100 - 20) % 10]
  || ["th", "st", "nd", "rd"][n % 100] || "th");

/**
 * The job: a queue of people who want something on the calendar, and fewer
 * slots than there are requests.
 *
 * Every other member of this chamber is handed a calendar. The Speaker is
 * handed this, and the power is almost entirely negative — a bill that does not
 * get a rule does not get a vote, cannot be debated and cannot be amended by
 * anybody. Nothing here happens because the Speaker wanted it; a great deal
 * fails to happen because the Speaker did not.
 */
export function calendarCard(board) {
  const calendar = board.calendar;
  if (!calendar || !calendar.requests?.length || board.state?.docket?.scheduled) return "";

  return `<div class="card card--accent" id="calendarCard">
    <div class="card__head">
      <span class="eyebrow">📅 You set the calendar</span>
      <span class="hint">${calendar.slots} of ${calendar.requests.length} can have the floor</span>
    </div>
    <p class="hint" style="margin:6px 0 12px">
      Everything you leave off is somebody who asked and did not get it, and they are counting.
    </p>
    <div class="rows">
      ${calendar.requests.map((r) => `
        <button class="career office" data-sched="${escapeHtml(r.id)}">
          <span class="office__text">
            <span class="office__title">${r.mustPass ? "⚠️ " : ""}${escapeHtml(r.bill.title)}</span>
            <span class="office__lede">${escapeHtml(r.bill.brief || "")}</span>
            <span class="office__lede">
              <b>${escapeHtml(r.wanted)}</b> · ${escapeHtml(r.note)}
              ${r.ownSide === false
                ? ' · <span style="color:var(--red)">most of your caucus is against it</span>'
                : ""}
            </span>
          </span>
          <span class="career__go" data-tick>▸</span>
        </button>`).join("")}
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--primary" data-speaker="calendar">Send these to the floor →</button>
    </div>
  </div>`;
}

/** What holding it is like, once you do. */
function chairCard(board) {
  const chair = board.chair;
  if (!chair) return "";
  const motions = board.chairMotions || [];

  return `<div class="card ${chair.at >= 0.1 ? "card--alarm" : ""}" id="speakerCard">
    <div class="card__head">
      <span class="eyebrow">🪑 You are the Speaker</span>
      <span class="hint">${Math.round(chair.at * 100)}% this month</span>
    </div>
    <p class="hint" style="margin:6px 0 10px">
      The chair is not a power so much as a standing threat, and the price of it was set
      on the day you took it.
    </p>
    <div class="rows">
      ${chair.reasons.map((r) => `<div class="career office" style="cursor:default">
        <span class="office__text"><span class="office__lede">${escapeHtml(r)}</span></span>
      </div>`).join("")}
    </div>
    ${motions.length ? `<p class="hint" style="margin:12px 0 0">
      <b>Filed against you:</b> ${motions.length} time${motions.length === 1 ? "" : "s"} this career.
    </p>` : ""}
  </div>`;
}

/** The Speaker's own calendar, which is a different card and a different act. */
export function wireCalendar(onDone) {
  const card = $("calendarCard");
  if (!card) return;
  const picked = new Set();

  card.onclick = async (e) => {
    const row = e.target.closest("[data-sched]");
    if (row) {
      const id = row.dataset.sched;
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      row.classList.toggle("is-selected", picked.has(id));
      row.querySelector("[data-tick]").textContent = picked.has(id) ? "✓" : "▸";
      return;
    }
    if (!e.target.closest('[data-speaker="calendar"]')) return;

    loader(true, "The Rules Committee is writing the rule…");
    try {
      const data = await setCalendar(G.state, [...picked]);
      G.state = data.state;
      saveCareer();
      if (data.refused.length) {
        alert(`On the floor: ${data.scheduled.join(", ") || "nothing"}.\n\n`
          + `Told no: ${data.refused.map((r) => `${r.title} (${r.wanted})`).join("; ")}.`);
      }
      onDone?.();
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };
}

export function wireSpeaker(onDone) {
  refresh = onDone;
  const card = $("speakerCard");
  if (!card) return;

  card.onclick = async (e) => {
    const concedeTo = e.target.closest("[data-concede]");
    const act = e.target.closest("[data-speaker]");
    if (!concedeTo && !act) return;

    loader(true, concedeTo ? "You are agreeing to something…" : "The clerk is calling the roll…");
    try {
      const data = concedeTo
        ? await speakerAction(G.state, "concede", concedeTo.dataset.concede)
        : await speakerAction(G.state, act.dataset.speaker);
      G.state = data.state;
      saveCareer();
      if (data.settled) alert(data.settled.note);
      else if (data.note) alert(data.note);
      refresh?.();
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };
}
