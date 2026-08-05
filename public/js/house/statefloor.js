import { $, show, escapeHtml, loader, monthLabel } from "../util.js";
import { G, saveCareer } from "../store.js";
import {
  statehouseFloor, statehouseVote, statehouseAdvance, statehouseHearing,
} from "../api.js";
import { roomsCard, wireRooms, loadRooms } from "../cards/rooms.js";

/**
 * A month in a state legislature.
 *
 * Its own screen rather than the congressional floor with things hidden,
 * because almost nothing on that screen exists here. A state representative
 * cannot file a discharge petition, has no gavel worth the name, sees no whip
 * count and will never vote on articles of impeachment. What they have instead
 * is three facts that no congressional screen has ever had to show: whether the
 * chamber is even sitting this month, what the seat pays, and whether the
 * budget balances.
 */

let handlers = {};
let board = null;

const CALENDAR = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export async function renderStateFloor(hooks) {
  handlers = hooks;
  loader(true, "The clerk is reading the calendar…");
  try {
    board = await statehouseFloor(G.state);
    if (board.state) {
      G.state = board.state;
      saveCareer();
    }
    await loadRooms(G.state, null);
  } catch (err) {
    alert("The floor could not be read: " + err.message);
    return;
  } finally { loader(false); }

  paint();
}

function paint() {
  const state = G.state;
  const chamber = board.chamber || {};
  const calendarMonth = CALENDAR[((state.month || 1) - 1) % 12];

  $("floorBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${escapeHtml(state.scenario.presidentName)}</h1>
        <div class="dash-head__sub">
          State Representative · ${escapeHtml(state.seat.seat)} · ${escapeHtml(state.seat.stateName)}
        </div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${escapeHtml(calendarMonth)}</h2>
        <div class="dash-head__sub">${board.inSession ? "The House is sitting" : "Adjourned"}</div>
      </div>
    </div>

    <div class="tiles tiles--four">
      ${tile("Your district", `${Math.round(state.approval)}%`, escapeHtml(state.seat.seat))}
      ${tile("Your caucus", `${Math.round(state.leadership)}%`, escapeHtml(state.caucus))}
      ${tile("The chamber", `${chamber.R}–${chamber.D}`, `${chamber.seats} seats · ${escapeHtml(chamber.majority)}`)}
      ${tile("The budget", `$${Math.round(board.budget.balance)}m`,
        board.budget.balanced ? "In balance" : "In deficit")}
    </div>

    <div class="card ${board.budget.balanced ? "" : "card--alarm"}">
      <span class="eyebrow">🏛️ ${escapeHtml(state.seat.stateName)}</span>
      <p style="margin:8px 0 0">${escapeHtml(board.budget.note)}</p>
      <p class="hint" style="margin:8px 0 0">
        Governor ${escapeHtml(board.governor.name)} (${escapeHtml(board.governor.party)}) signs or vetoes
        everything this chamber passes${board.governor.party === state.caucus
          ? " — and is of your party." : ", and is not of your party."}
      </p>
      ${board.termLimit ? `<p class="hint" style="margin:8px 0 0">
        <b>${board.termLimit.limited
          ? (board.termLimit.last
            ? "This is your last term here."
            : `${board.termLimit.remaining} more term${board.termLimit.remaining === 1 ? "" : "s"} after this one.`)
          : "No term limits."}</b>
        ${escapeHtml(board.termLimit.note)}${board.termLimit.after ? ` ${escapeHtml(board.termLimit.after)}` : ""}
      </p>` : ""}
      ${board.job ? `<p class="hint" style="margin:8px 0 0">
        ${escapeHtml(board.job.note)} Out of session you are back at ${escapeHtml(board.job.what)}.
      </p>` : `<p class="hint" style="margin:8px 0 0">
        A full-time legislature, which is rare and is why this one has staff.
      </p>`}
    </div>

    ${committeeCard()}
    ${roomsCard()}

    ${board.inSession ? (board.bills.length ? `
      <div class="card">
        <span class="eyebrow">🗳️ On the floor</span>
        <p class="hint" style="margin:6px 0 0">
          ${board.bills.length === 1 ? "One bill" : `${board.bills.length} bills`} up for a vote${
            board.written ? "" : ", drawn from the standing calendar"}.
        </p>
      </div>
      ${board.bills.map(billCard).join("")}
    ` : `<div class="card">
      <span class="eyebrow">🕰️ A quiet week in the chamber</span>
      <p style="margin:10px 0 0">Nothing is scheduled. Committee work, and the phone.</p>
    </div>`) : `
      <div class="card">
        <span class="eyebrow">🚪 The legislature is adjourned</span>
        <p style="margin:10px 0 0">
          It sits ${escapeHtml(CALENDAR[chamber.session[0] - 1])} to
          ${escapeHtml(CALENDAR[chamber.session[1] - 1])}. Until then you are in the district,
          and at work.
        </p>
      </div>`}

    <div class="card">
      <div class="btn-row">
        <button class="btn" id="stateCareers">← Careers</button>
        <button class="btn btn--blue" id="stateNext">
          ${board.inSession ? "End the week →" : "Next month →"}
        </button>
      </div>
    </div>`;

  wireRooms(handlers);
  for (const bill of board.bills) wireBill(bill);
  $("stateCareers").onclick = () => handlers.onCareers?.();
  $("stateNext").onclick = advance;
  show("floor");
}

const tile = (label, value, sub) => `<div class="tile">
  <span class="eyebrow">${escapeHtml(label)}</span>
  <div class="tile__value">${value}</div>
  <div class="tile__sub">${sub}</div>
</div>`;

const stanceClass = (p) => (p === "yes" ? "stance--yes" : "stance--no");

/**
 * One bill, with the two people you answer to already on the record and the
 * one number Congress never has to look at.
 */
/**
 * The rooms you sit in, and the one you run.
 *
 * A state legislator sits on three or four committees rather than one, which
 * means a backbencher is genuinely in the room for a large share of everything
 * the legislature does — far more of the institution than a congressman ever
 * touches.
 */
function committeeCard() {
  const mine = board.committees || [];
  const buried = board.buried || [];
  if (!mine.length && !buried.length) return "";

  return `<div class="card">
    <span class="eyebrow">📂 Your committees</span>
    <div class="rows" style="margin-top:10px">
      ${mine.map((c) => `<div class="career office" style="cursor:default">
        <span class="office__text">
          <span class="office__title">${escapeHtml(c.name)}${c.chair ? " — you chair it" : ""}</span>
          <span class="office__lede">${escapeHtml(c.remit || "")}</span>
        </span>
      </div>`).join("")}
    </div>
    ${buried.length ? `
      <p class="hint" style="margin:14px 0 6px">
        <b>Never heard this month:</b> most bills in most legislatures die exactly like this —
        no hearing, no vote, no record, nobody's name on it.
      </p>
      <div class="rows">
        ${buried.map((b) => `<div class="career office" style="cursor:default">
          <span class="office__text">
            <span class="office__title" style="opacity:.7">${escapeHtml(b.title)}</span>
            <span class="office__lede">Died in ${escapeHtml(b.committee)}${
              b.inRoom ? " — a committee you sit on" : ""}</span>
          </span>
        </div>`).join("")}
      </div>` : ""}
  </div>`;
}

function billCard(bill) {
  /**
   * A bill in your own committee is not a vote yet. You decide whether it is
   * heard at all, which is a different and much larger act than voting on it.
   */
  if (bill.awaiting) {
    return `<div class="card card--accent" data-bill="${escapeHtml(bill.id)}">
      <div class="card__head">
        <span class="eyebrow">⚖️ Your committee — it is heard or it is not</span>
        <span class="hint">${escapeHtml(bill.domain || "")}</span>
      </div>
      <h3 class="display display--sm" style="margin:4px 0 6px">${escapeHtml(bill.title)}</h3>
      <p class="brief__body" style="margin:0 0 10px">${escapeHtml(bill.brief || "")}</p>
      <p class="hint" style="margin:0 0 12px">
        Nothing about this is on the record. Schedule it and the chamber votes; leave it and by
        the end of the session it is as though it was never filed.
      </p>
      <div class="btn-row">
        <button class="btn btn--green" data-hear="yes">Give it a hearing</button>
        <button class="btn btn--danger" data-hear="no">Leave it in the drawer</button>
      </div>
      <div class="vote-result" data-result hidden></div>
    </div>`;
  }

  const split = bill.party.position !== bill.district.position;
  return `<div class="card${split ? " card--alarm" : ""}" data-bill="${escapeHtml(bill.id)}">
    <div class="card__head">
      <span class="eyebrow">${split ? "⚔️ They disagree" : "🤝 They agree"}</span>
      <span class="hint">${escapeHtml(bill.domain || "")}</span>
    </div>
    <h3 class="display display--sm" style="margin:4px 0 6px">${escapeHtml(bill.title)}</h3>
    <p class="brief__body" style="margin:0 0 10px">${escapeHtml(bill.brief || "")}</p>
    <p class="hint" style="margin:0 0 10px">
      ${bill.because ? `<b>Why it is on the floor:</b> ${escapeHtml(bill.because)}. ` : ""}
      <b>Cost to the budget:</b> ${bill.cost > 0 ? `$${bill.cost}m` : bill.cost < 0
        ? `saves $${Math.abs(bill.cost)}m` : "nothing"}.
    </p>

    <div class="stances stances--three">
      <div class="stance ${stanceClass(bill.party.position)}">
        <span class="stance__who">Your caucus</span>
        <span class="stance__pos">${bill.party.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(bill.party.reason)}</span>
      </div>
      <div class="stance ${stanceClass(bill.district.position)}">
        <span class="stance__who">${escapeHtml(G.state.seat.seat)}</span>
        <span class="stance__pos">${bill.district.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(bill.district.reason)}</span>
      </div>
      <div class="stance stance--you ${stanceClass(bill.conviction.position)}">
        <span class="stance__who">You</span>
        <span class="stance__pos">${bill.conviction.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(bill.conviction.reason)}</span>
      </div>
    </div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--green" data-vote="yes">Aye</button>
      <button class="btn btn--danger" data-vote="no">No</button>
      <button class="btn" data-vote="abstain">Present</button>
    </div>
    <div class="vote-result" data-result hidden></div>
  </div>`;
}

function wireBill(bill) {
  const card = document.querySelector(`[data-bill="${bill.id}"]`);
  if (!card) return;
  card.onclick = async (e) => {
    const gavel = e.target.closest("[data-hear]");
    if (gavel) {
      loader(true, gavel.dataset.hear === "yes" ? "Scheduling it…" : "It goes in the drawer…");
      try {
        const data = await statehouseHearing(G.state, bill, gavel.dataset.hear === "yes");
        G.state = data.state;
        saveCareer();
        alert(data.result.note);
        renderStateFloor(handlers);
      } catch (err) {
        alert(err.message);
      } finally { loader(false); }
      return;
    }

    const pick = e.target.closest("[data-vote]");
    if (!pick) return;
    loader(true, "The clerk is calling the roll…");
    try {
      const data = await statehouseVote(G.state, bill, pick.dataset.vote);
      G.state = data.state;
      saveCareer();
      showResult(card, data.result);
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };
}

const delta = (n) => `<b class="${n >= 0 ? "up" : "down"}">${n > 0 ? "+" : ""}${n}</b>`;

function showResult(card, result) {
  card.querySelectorAll("[data-vote]").forEach((b) => { b.disabled = true; });
  const box = card.querySelector("[data-result]");
  box.hidden = false;
  /**
   * Which of the three gates it died at, rather than whether it passed.
   *
   * A bill leaves this floor and meets a state senate, a governor and — if the
   * governor refuses — this chamber again at a threshold that is different in
   * every state. The badge has to say which one stopped it, because "failed" on
   * its own tells a member nothing about what to do differently. See
   * `throughTheBuilding`.
   */
  const stage = result.onward?.stage;
  const label = !result.passed ? "Failed on this floor"
    : stage === "senate" ? "Died in the state senate"
    : stage === "vetoed" ? "Vetoed"
    : stage === "overridden" ? "Passed over the veto"
    : "Signed into law";

  box.innerHTML = `
    <div class="vote-result__head">
      <span class="badge ${result.enacted ? "badge--live" : "badge--red"}">
        ${label} · ${result.tally.yes}–${result.tally.no} here</span>
      <span class="hint">You voted <b>${result.yourVote.toUpperCase()}</b></span>
    </div>
    <p style="margin:10px 0 0">${escapeHtml(result.note)}</p>
    <div class="vote-result__deltas">
      <span>District ${delta(result.district.delta)}</span>
      <span>Caucus ${delta(result.party.delta)}</span>
      ${result.budget.moved ? `<span>Budget ${delta(result.budget.moved)}m</span>` : ""}
    </div>`;
}

async function advance() {
  loader(true, "The month turns over…");
  try {
    const data = await statehouseAdvance(G.state);
    G.state = data.state;
    saveCareer();
    if (G.state.over) {
      alert(G.state.ending.reason);
      return handlers.onCareers?.();
    }
    if (data.reelection) {
      alert(data.reelection.won
        ? `Re-elected in ${G.state.seat.seat} by ${Math.abs(data.reelection.margin).toFixed(1)}.`
        : `You lost ${G.state.seat.seat}.`);
    }
    renderStateFloor(handlers);
  } catch (err) {
    alert(err.message);
  } finally { loader(false); }
}

void monthLabel;
