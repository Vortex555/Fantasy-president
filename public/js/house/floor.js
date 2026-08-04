"use strict";

import { $, show, escapeHtml, loader, monthLabel } from "../util.js";
import { G, saveCareer } from "../store.js";
import { chamberCard } from "./election.js";
import {
  houseFloor, houseVote, houseAdvance, houseSponsor, houseCommittee, houseWhip, houseArticles,
  senateFloor, senateVote, senateFilibuster, senateAdvance,
  senateSponsor, senateCommittee, senateWhip, senateArticles, senateConfirm,
  filePetition, pushPetition, moveVacate, callHearing, doCasework, askEarmark,
  endorseAgainst, raiseForColleagues,
} from "../api.js";
import {
  nationCard, falloutBlock, staffCard, wireStaff, resetStaffLogIfNewMonth,
} from "./nation.js";

/**
 * Both chambers run through this screen.
 *
 * The shape is identical — your two standings, what leadership scheduled, and
 * which way you go on it — so the differences are parameterised rather than
 * duplicated into a second four-hundred-line file. What actually differs is the
 * term length, the word for your constituency, and the fact that a senator can
 * stop the chamber on their own.
 *
 * Every call a member can make belongs to a chamber. Leaving the filing, the
 * gavel, the whip and the impeachment vote pointed at the House endpoints meant
 * a senator's bill was counted by 435 people and their whip count was taken in
 * the wrong building.
 */
const CHAMBER = {
  house: {
    term: 24, seatWord: "district", chamberName: "House",
    floor: houseFloor, vote: houseVote, advance: houseAdvance,
    sponsor: houseSponsor, committee: houseCommittee, whip: houseWhip, articles: houseArticles,
  },
  senate: {
    term: 72, seatWord: "state", chamberName: "Senate",
    floor: senateFloor, vote: senateVote, advance: senateAdvance,
    sponsor: senateSponsor, committee: senateCommittee, whip: senateWhip, articles: senateArticles,
  },
};

const chamber = () => CHAMBER[G.state?.office] || CHAMBER.house;

/**
 * The member's month.
 *
 * Leadership schedules; you vote. Each bill is shown with both of the people
 * you answer to already on the record — your caucus and your district — because
 * the decision is never "is this a good bill", it is "which of these two am I
 * disappointing today, and can I afford it".
 */

let handlers = {};
let board = null;
/** A congressional election the member was not standing in, waiting to be read. */
let pendingCycle = null;

export async function renderFloor(hooks) {
  handlers = hooks;
  const state = G.state;

  loader(true, "The Rules Committee is reporting…");
  try {
    board = await chamber().floor(state);
    /**
     * The calendar is settled once a month and stored on the career, so the
     * reply carries the save forward. Without keeping it, every repaint would
     * ask for the schedule again — and with a model configured, be written a
     * different one and billed for it.
     */
    if (board.state) {
      G.state = board.state;
      saveCareer();
    }
  } catch (err) {
    alert("The floor schedule could not be read: " + err.message);
    return handlers.onDashboard();
  } finally {
    loader(false);
  }

  resetStaffLogIfNewMonth(G.state);
  paint();
}

function paint() {
  const state = G.state;
  const seat = state.seat;
  const voted = new Set((state.voteLog || []).map((v) => v.id));
  const pending = board.bills.filter((b) => !voted.has(b.id));

  $("floorBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${escapeHtml(state.scenario.presidentName)}</h1>
        <div class="dash-head__sub">${escapeHtml(seat.district)} · ${escapeHtml(seat.stateName)} ·
          ${escapeHtml(state.scenario.party)} · term ${state.term}, month ${state.month} of ${chamber().term}</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${escapeHtml(monthLabel(state.month, state.scenario.startYear))}</h2>
        <div class="dash-head__sub">${board.monthsLeft} months to the election</div>
      </div>
    </div>

    <div class="tiles tiles--four">
      ${meter(`Your ${chamber().seatWord}`, state.approval,
        `How ${state.office === "senate" ? seat.stateName : seat.district} rates you`)}
      ${meter("Your leadership", state.leadership, state.independent
        ? `How the ${state.caucus} caucus you sit with rates you`
        : "How the caucus rates you")}
      ${board.integrity != null
        ? meter("Your integrity", board.integrity,
            `How often you vote like a ${board.ideology || "believer"}`)
        : plain("Seniority", `Term ${seat.seniority}`, "Clout, slowly earned")}
      ${plain("Re-election", forecastLabel(board.forecast), forecastNote(board.forecast))}
    </div>
    ${board.forecast?.primary ? `<div class="card card--alarm">
      <span class="eyebrow">🗳️ A primary is being organised against you</span>
      <p style="margin:10px 0 0">${escapeHtml(board.forecast.primary.note)}</p>
    </div>` : ""}
    ${factionCard(board)}
    ${peopleCard(board)}
    ${coalitionCard(board)}

    <div class="card">
      <div class="card__head">
        <span class="eyebrow">🏛️ ${escapeHtml(board.rank.title)}</span>
        ${board.capital > 0 || board.rank.id === "whip" || board.rank.id === "speaker"
          ? `<span class="hint">Favours owed to you: <b>${Math.round(board.capital)}</b></span>` : ""}
      </div>
      <p style="margin:8px 0 0">${escapeHtml(board.rank.power)}</p>
      ${board.committee ? `<p class="hint" style="margin:10px 0 0">
        You sit on <b>${escapeHtml(board.committee.name)}</b> — ${escapeHtml(board.committee.remit)}
      </p>` : ""}
    </div>

    ${board.grudges?.length ? `<div class="card">
      <span class="eyebrow">🧠 What ${escapeHtml(seat.stateName)} has not forgotten</span>
      <p class="hint" style="margin:6px 0 12px">
        Six years is a long time. These fade every month — a vote taken early is nearly forgiven
        by the election, and one taken late is not.
      </p>
      <div class="flips">
        ${board.grudges.map((g) => `<span class="flip flip--loss">${escapeHtml(g.title)}<i>${g.weight.toFixed(1)}</i></span>`).join("")}
      </div>
    </div>` : ""}

    ${nationCard(board.nation, board.written)}

    ${pendingCycle ? chamberCard(pendingCycle.cycle) : ""}
    ${pendingCycle?.ladder && (pendingCycle.ladder.promoted || pendingCycle.ladder.demoted)
      ? `<div class="card ${pendingCycle.ladder.promoted ? "card--accent" : "card--alarm"}">
          <span class="eyebrow">${pendingCycle.ladder.promoted ? "⬆️" : "⬇️"} A new Congress picks new leadership</span>
          <p style="margin:10px 0 0">${escapeHtml(pendingCycle.ladder.note)}</p>
        </div>` : ""}

    ${partyCard(board)}
    ${districtCard(board)}
    ${hearingCard(board)}
    ${vacateCard(board)}
    ${petitionCard(board)}
    ${board.articles ? articlesCard(board.articles) : ""}
    ${board.nomination ? nominationCard(board.nomination) : ""}

    ${pending.length ? `
      <div class="card">
        <span class="eyebrow">🗳️ On the floor this month</span>
        <p class="hint" style="margin:6px 0 0">
          ${pending.length === 1 ? "One bill" : `${pending.length} bills`} up for a vote.
          Both of the people you answer to are already on the record.
        </p>
      </div>
      ${pending.map(billCard).join("")}
    ` : `
      <div class="card">
        <span class="eyebrow">🕰️ A quiet month on the floor</span>
        <p style="margin:10px 0 0">Nothing is scheduled. Members use months like this to work the
          district, raise money, and file the bill nobody asked for.</p>
      </div>`}

    ${board.canSponsor ? sponsorCard() : `
      <div class="card">
        <span class="eyebrow">📋 Your own legislation</span>
        <p class="hint" style="margin:8px 0 0">You have filed recently. The next one can go in a few months.</p>
      </div>`}

    ${staffCard(board.staff)}

    <div class="card">
      <span class="eyebrow">📜 The record</span>
      <p class="hint" style="margin:8px 0 12px">
        What this chamber has actually done to the country since you were sworn in — every
        indicator, and which bills bent which lines.
      </p>
      <button class="btn btn--sm" id="seeCountry">See the country change →</button>
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="endMonth" style="max-width:340px">
        ${state.month >= chamber().term ? "To the Election →" : "End the Month →"}
      </button>
    </div>`;

  if (board.articles) wireArticles();
  if (board.nomination) wireNomination();
  for (const b of pending) wireBill(b);
  wirePetition();
  wireVacate();
  wireHearing();
  wireDistrict();
  wireParty();
  if (board.canSponsor) wireSponsor();
  wireStaff();
  const country = $("seeCountry");
  if (country) country.onclick = () => handlers.onCountry();
  $("endMonth").onclick = endMonth;
  // Read once. It is news, not a standing feature of the floor.
  pendingCycle = null;
  show("floor");
  window.scrollTo(0, 0);
}

// --- The vote only the House casts ------------------------------------------

/**
 * Impeachment. Shown ahead of everything else on the floor, because for the
 * month it is on the calendar there is nothing else on the floor.
 */
function articlesCard(a) {
  const s = a.stance;
  return `<div class="card card--alarm" id="articlesCard">
    <div class="card__head">
      <span class="eyebrow">⚖️ Articles of impeachment</span>
      <span class="hint">${a.articles.length} articles reported</span>
    </div>
    <h3 class="display display--sm" style="margin:4px 0 6px">
      The impeachment of President ${escapeHtml(a.president.name)}</h3>
    <p class="brief__body" style="margin:0 0 12px">
      ${a.articles.map((x) => escapeHtml(x.title)).join(" · ")}
    </p>

    <div class="stances">
      <div class="stance ${s.party.position === "yes" ? "stance--yes" : "stance--no"}">
        <span class="stance__who">${G.state.independent ? escapeHtml(G.state.caucus) + " caucus" : "Your leadership"}</span>
        <span class="stance__pos">${s.party.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(s.party.reason)}</span>
      </div>
      <div class="stance ${s.district.position === "yes" ? "stance--yes" : "stance--no"}">
        <span class="stance__who">${escapeHtml(G.state.seat.district)}</span>
        <span class="stance__pos">${s.district.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(s.district.reason)}</span>
      </div>
    </div>
    <p class="hint" style="margin:12px 0 0">
      There is no version of this vote nobody notices. It follows you.
    </p>
    <div class="btn-row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn" data-articles="abstain">Abstain</button>
      <button class="btn btn--danger" data-articles="no">Vote to Acquit</button>
      <button class="btn btn--primary" data-articles="yes">Vote to Impeach</button>
    </div>
    <div class="vote-result hidden"></div>
  </div>`;
}

function wireArticles() {
  const card = $("articlesCard");
  if (!card) return;
  card.onclick = async (e) => {
    const btn = e.target.closest("[data-articles]");
    if (!btn) return;
    for (const b of card.querySelectorAll("[data-articles]")) b.disabled = true;
    loader(true, "The Clerk is calling the roll…");
    try {
      const data = await chamber().articles(G.state, btn.dataset.articles);
      G.state = data.state;
      saveCareer();
      const r = data.result;
      card.querySelector(".btn-row").remove();
      const box = card.querySelector(".vote-result");
      box.className = "vote-result";
      box.innerHTML = `
        <div class="vote-result__head">
          <span class="badge ${r.impeached ? "badge--red" : "badge--live"}">
            ${r.impeached ? "Impeached" : "Acquitted"} ${r.tally.yes}–${r.tally.no}</span>
          <span class="hint">You voted <b>${r.yourVote.toUpperCase()}</b></span>
        </div>
        <p style="margin:10px 0 0">${escapeHtml(r.note)}</p>
        <div class="vote-result__deltas">
          <span>District <b class="${r.district.delta >= 0 ? "up" : "down"}">${r.district.delta > 0 ? "+" : ""}${r.district.delta}</b></span>
          <span>Leadership <b class="${r.party.delta >= 0 ? "up" : "down"}">${r.party.delta > 0 ? "+" : ""}${r.party.delta}</b></span>
        </div>`;
      refreshMeters();
    } catch (err) {
      alert("The vote could not be recorded: " + err.message);
      for (const b of card.querySelectorAll("[data-articles]")) b.disabled = false;
    } finally {
      loader(false);
    }
  };
}

// --- Advice and consent -----------------------------------------------------

/**
 * A nomination, which is the same bind as a bill with a third question attached:
 * can this person do the job. That question is why the card shows competence as
 * its own meter rather than folding it into the two stances — a senator of the
 * President's own party facing an indefensible pick is the most interesting vote
 * in the mode, and it only reads that way if you can see all three pressures at
 * once.
 */
/**
 * The war inside your own party.
 *
 * Every other lever points at the other side or at leadership. This is the only
 * one pointed at the people sitting next to you — and congressional careers are
 * ended by their own party far more often than by the other one.
 */
function partyCard(board) {
  const p = board.party;
  if (!p) return "";
  const d = board.district || {};

  return `<div class="card" id="partyCard">
    <div class="card__head">
      <span class="eyebrow">🔪 Your own side</span>
      <span class="hint">${p.seatsTaken ? `${p.seatsTaken} seat${p.seatsTaken === 1 ? "" : "s"} taken` : ""}</span>
    </div>

    ${p.challenges.length ? `<p class="hint" style="margin:6px 0 12px">
      ${p.challenges.map((c) => `Primary season: your challenger against <b>${escapeHtml(c.name)}</b>
        — ${c.odds}% and counting.`).join("<br>")}
    </p>` : ""}

    ${p.challenges.length < p.maxChallenges && p.targets.length ? `
      <p class="hint" style="margin:6px 0 12px">
        An afternoon on the phone, every friend you had in leadership, and a
        chance at a seat that comes back thinking like you.
      </p>
      <div class="rows">
        ${p.targets.slice(0, 3).map((t) => `<button class="career office" data-endorse="${escapeHtml(t.seat)}">
          <span class="office__text">
            <span class="office__title">${escapeHtml(t.name)} · ${escapeHtml(t.seat)}</span>
            <span class="office__lede">${escapeHtml(t.ideology)} — ${escapeHtml(t.faction)}</span>
            <span class="office__lede">A challenger wins about <b>${t.odds}%</b> of the time</span>
          </span>
          <span class="career__go">▸</span>
        </button>`).join("")}
      </div>` : ""}

    <div class="gavel" style="margin-top:14px">
      <span class="eyebrow">🍗 The circuit</span>
      <p class="hint" style="margin:6px 0 10px">
        ${d.fundraisedThisMonth
          ? "You have done the circuit this month. There are only so many rubber-chicken dinners in a calendar."
          : "Four fundraisers in three states for members who need the money more than you do. None of it for your seat, and every one of them knows it."}
      </p>
      ${d.fundraisedThisMonth ? "" : `<button class="btn btn--sm" data-fundraise>Headline them</button>`}
    </div>
  </div>`;
}

/**
 * The half of the job nobody writes a story about.
 *
 * Every other action in the mode happens in Washington, and the district existed
 * only as a number that judged you — approval moved when you voted and could not
 * be worked on directly. Casework is what congressional offices actually spend
 * most of their staff time on, and its cost is the honest one: days at home are
 * days not in the building.
 */
function districtCard(board) {
  const d = board.district;
  if (!d) return "";
  const seat = G.state.seat?.district || "your seat";

  return `<div class="card" id="districtCard">
    <div class="card__head">
      <span class="eyebrow">🏠 Back in ${escapeHtml(seat)}</span>
      <span class="hint">${d.cases} case${d.cases === 1 ? "" : "s"} worked</span>
    </div>
    ${d.doneThisMonth ? `<p class="hint" style="margin:6px 0 0">
      Your office has done what it can this month. The queue is not infinite and
      neither are your staff.
    </p>` : `
      <p class="hint" style="margin:6px 0 12px">
        Benefits stuck for fourteen months, a passport for a funeral, a disability
        claim denied over a typo. It buys goodwill from people who disagree with
        every vote you cast — and days at home are days you are not in the room
        when the favours are handed out.
      </p>
      <div class="whipbox__act">
        <input type="range" min="1" max="${d.maxEffort}" value="1" data-case-range />
        <span class="hint" data-case-label>1 day a week in the district</span>
        <button class="btn btn--sm" data-case-go>Work the casework</button>
      </div>`}
    ${d.canEarmark ? `<div class="gavel" style="margin-top:14px">
      <span class="eyebrow">💰 A project for the district</span>
      <p class="hint" style="margin:6px 0 10px">
        ${d.earmarkUsed
          ? "You have had your project this Congress. Asking twice is how members stop getting one."
          : "A bridge, a clinic, a water main — with your name on the paperwork. The money is allocated by people who will want something back."}
      </p>
      ${d.earmarkUsed ? "" : `<button class="btn btn--sm" data-earmark>Ask for it</button>`}
    </div>` : ""}
  </div>`;
}

/**
 * The gavel used as a platform rather than a veto.
 *
 * A chairmanship was worth burying a bill and amending one — both of them powers
 * over legislation somebody else wrote. A hearing passes nothing and moves no
 * votes, and produces the only thing the chamber never generated: being known by
 * people who cannot name their own member. Which is what every race above this
 * one is decided on.
 */
function hearingCard(board) {
  const h = board.hearings;
  if (!h?.canHold) return "";

  return `<div class="card" id="hearingCard">
    <div class="card__head">
      <span class="eyebrow">🎤 Your committee</span>
      <span class="hint">National profile ${h.profile}</span>
    </div>
    ${h.heldThisMonth ? `<p class="hint" style="margin:6px 0 0">
      Your committee has sat this month. There is a calendar for these too.
    </p>` : !h.targets.length ? `<p class="hint" style="margin:6px 0 0">
      Nothing in your jurisdiction is worth a camera this month. A hearing into a
      problem nobody is thinking about is an empty room with the lights on.
    </p>` : `
      <p class="hint" style="margin:6px 0 12px">
        A hearing changes no law and no vote. It makes you somebody the country has
        heard of, which is what the races above this one are decided on.
      </p>
      <div class="rows">
        ${h.targets.map((t) => `<div class="career office" style="cursor:default">
          <span class="office__text">
            <span class="office__title">${escapeHtml(t.title)}</span>
            <span class="office__lede">Severity ${t.severity}${
              t.ownSide ? " · your own party's administration, and they will know" : ""}</span>
          </span>
          <span class="btn-row" style="gap:6px">
            <button class="btn btn--sm" data-hear="${escapeHtml(t.id)}">Take evidence</button>
            ${h.canCompel
              ? `<button class="btn btn--danger btn--sm" data-hear="${escapeHtml(t.id)}" data-compel="1">Subpoena</button>`
              : ""}
          </span>
        </div>`).join("")}
      </div>`}
  </div>`;
}

/**
 * Removing the Speaker.
 *
 * The only place a bloc's ability to deny a majority turns into something it can
 * spend. Both numbers are on the card because the decision is entirely in them:
 * the other party votes for the chaos almost to a member, and the twenty-odd
 * names that decide it come off your own side — a handful of people willing to
 * move against their own Speaker while the rest of their caucus watches.
 */
function vacateCard(board) {
  if (board.vacancy) {
    return `<div class="card card--alarm">
      <span class="eyebrow">🪑 The chair is empty</span>
      <p style="margin:8px 0 0">
        No Speaker, so no calendar. Nothing is scheduled and nothing can be for
        another ${board.vacancy} month${board.vacancy === 1 ? "" : "s"} — and every member
        is being asked daily who they could live with.
      </p>
    </div>`;
  }
  const v = board.vacate;
  if (!v || !v.total) return "";
  const short = v.threshold - v.yes;

  return `<div class="card" id="vacateCard">
    <span class="eyebrow">🪑 Motion to vacate the chair</span>
    <p class="hint" style="margin:6px 0 10px">
      Privileged, so it cannot be buried — but it is your own Speaker, and the
      building never forgets who moved it.
    </p>
    <p class="hint" style="margin:0 0 10px">
      <b>${v.yes}</b> of ${v.threshold} today. The other party supplies ${v.minorityYes};
      ${v.rebels} of your own would go with you${short > 0 ? `, which is ${short} short` : ""}.
    </p>
    <div class="whipbox__act">
      <input type="range" min="0" max="${Math.floor(G.state.capital ?? 0)}" value="0" data-vac-range />
      <span class="hint" data-vac-label>Call in 0 favours</span>
      <button class="btn btn--danger btn--sm" data-vac-go>Move it</button>
    </div>
  </div>`;
}

/**
 * The one lever on the calendar a member without a gavel has.
 *
 * Burying a bill needs a chair, amending one needs a subchair, the whip count
 * needs a whip — and until this, the schedule belonged entirely to leadership.
 * A discharge petition needs no rank at all: enough signatures and the bill is
 * voted on whether the people who set the floor want it voted on or not.
 *
 * Both numbers are shown because both are the decision. The ceiling is how many
 * would ever sign, which is far short of how many would vote for it, and if it
 * sits under the line then patience will never get there and only favours will.
 */
function petitionCard(board) {
  const live = board.petition;
  const shelf = board.shelf || [];
  if (!live && !shelf.length) return "";

  if (live) {
    const short = live.needed - live.signatures;
    const stalled = live.signatures >= live.ceiling;
    return `<div class="card ${stalled ? "card--alarm" : "card--accent"}" id="petitionCard">
      <span class="eyebrow">✍️ Your discharge petition</span>
      <h3 class="display display--sm" style="margin:6px 0 4px">${escapeHtml(live.title)}</h3>
      <div class="track" style="margin:10px 0 6px">
        <i style="width:${Math.min(100, Math.round(live.signatures / live.needed * 100))}%;background:var(${
          stalled ? "--amber" : "--green"})"></i>
      </div>
      <p class="hint" style="margin:0">
        <b>${live.signatures}</b> of ${live.needed} signatures${
          short > 0 ? ` — ${short} short` : " — it goes to the floor"}.
        ${stalled
          ? "Everyone who was ever going to sign already has. The rest are people who will vote for it and will not put their name on it."
          : "Names are still coming in."}
      </p>
      <div class="whipbox__act" style="margin-top:12px">
        <input type="range" min="0" max="${Math.floor(G.state.capital ?? 0)}" value="0" data-pet-range />
        <span class="hint" data-pet-label>Call in 0 favours</span>
        <button class="btn btn--sm" data-pet-go>Work the list</button>
      </div>
    </div>`;
  }

  return `<div class="card" id="petitionCard">
    <span class="eyebrow">📂 Sitting in committee</span>
    <p class="hint" style="margin:6px 0 12px">
      These have the votes on the floor and cannot get the room, because most of
      the majority is against them and the majority sets the calendar. Enough
      signatures takes that decision away from leadership — and they will know
      exactly whose name is at the top.
    </p>
    <div class="rows">
      ${shelf.map((b) => `<button class="career office" data-petition="${escapeHtml(b.id)}">
        <span class="office__text">
          <span class="office__title">${escapeHtml(b.title)}</span>
          <span class="office__lede">${escapeHtml(b.brief || "")}</span>
          <span class="office__lede"><b>${b.floorVotes}</b> would vote for it ·
            <b>${b.ceiling}</b> would sign of the ${board.dischargeNeeded} needed${
              b.ceiling < board.dischargeNeeded ? " — the rest cost favours" : ""}</span>
        </span>
        <span class="career__go">▸</span>
      </button>`).join("")}
    </div>
  </div>`;
}

function nominationCard(n) {
  const s = n.stance;
  const nom = n.nominee;
  const q = s.qualification;
  return `<div class="card ${nom.unqualified ? "card--alarm" : "card--accent"}" id="nominationCard">
    <div class="card__head">
      <span class="eyebrow">⚖️ Advice and consent</span>
      <span class="hint">${escapeHtml(n.post.tenure)}</span>
    </div>
    <h3 class="display display--sm" style="margin:4px 0 6px">
      ${escapeHtml(nom.name)} — ${escapeHtml(n.post.title)}</h3>
    <p class="brief__body" style="margin:0 0 12px">
      President ${escapeHtml(n.president.name)} has sent up ${escapeHtml(nom.name)} to take charge of
      ${escapeHtml(n.post.remit)}. Nothing happens until this chamber votes.
    </p>

    <div class="stances">
      <div class="stance ${s.party.position === "yes" ? "stance--yes" : "stance--no"}">
        <span class="stance__who">${G.state.independent ? escapeHtml(G.state.caucus) + " caucus" : "Your leadership"}</span>
        <span class="stance__pos">${s.party.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(s.party.reason)}</span>
        <span class="stance__heat">Pressure ${s.party.intensity}</span>
      </div>
      <div class="stance ${s.district.position === "yes" ? "stance--yes" : "stance--no"}">
        <span class="stance__who">${escapeHtml(G.state.seat.stateName)}</span>
        <span class="stance__pos">${s.district.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(s.district.reason)}</span>
        <span class="stance__heat">Pressure ${s.district.intensity}</span>
      </div>
    </div>

    <div class="whipbox" style="margin-top:14px">
      <div class="whipbox__head">
        <span class="eyebrow">🎓 On the merits</span>
        <b class="${q.unqualified ? "down" : "up"}">${q.competence}%</b>
      </div>
      <p class="hint" style="margin:6px 0 0">${escapeHtml(q.note)}</p>
    </div>

    <p class="hint" style="margin:12px 0 0">${escapeHtml(s.district.pressureNote)}</p>

    <div class="btn-row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn" data-confirm="abstain">Abstain</button>
      <button class="btn btn--danger" data-confirm="no">Vote to Reject</button>
      <button class="btn btn--primary" data-confirm="yes">Vote to Confirm</button>
    </div>
    <div class="vote-result hidden"></div>
  </div>`;
}

function wireNomination() {
  const card = $("nominationCard");
  if (!card) return;
  card.onclick = async (e) => {
    const btn = e.target.closest("[data-confirm]");
    if (!btn) return;
    for (const b of card.querySelectorAll("[data-confirm]")) b.disabled = true;
    loader(true, "The clerk is calling the roll…");
    try {
      const data = await senateConfirm(G.state, btn.dataset.confirm);
      G.state = data.state;
      saveCareer();
      const r = data.result;
      const delta = (v) => `<b class="${v >= 0 ? "up" : "down"}">${v > 0 ? "+" : ""}${v}</b>`;
      card.querySelector(".btn-row").remove();
      const box = card.querySelector(".vote-result");
      box.className = "vote-result";
      box.innerHTML = `
        <div class="vote-result__head">
          <span class="badge ${r.confirmed ? "badge--live" : "badge--red"}">
            ${r.confirmed ? "Confirmed" : "Rejected"} ${r.tally.yes}–${r.tally.no}</span>
          <span class="hint">You voted <b>${r.yourVote.toUpperCase()}</b>${
            r.tally.crossed ? ` · ${r.tally.crossed} crossed over` : ""}${
            r.tally.defected ? ` · ${r.tally.defected} broke ranks` : ""}</span>
        </div>
        <p style="margin:10px 0 0">${escapeHtml(r.note)}</p>
        <div class="vote-result__deltas">
          <span>${escapeHtml(G.state.seat.stateName)} ${delta(r.district.delta)}</span>
          <span>Leadership ${delta(r.party.delta)}</span>
        </div>`;
      refreshMeters();
    } catch (err) {
      alert("The vote could not be recorded: " + err.message);
      for (const b of card.querySelectorAll("[data-confirm]")) b.disabled = false;
    } finally {
      loader(false);
    }
  };
}

// --- One bill ---------------------------------------------------------------

/**
 * The caucus inside the caucus.
 *
 * A chamber used to hold two organised bodies — the majority and the minority —
 * and four hundred and thirty-five members carrying ideologies that grouped them
 * into nothing. This is the bloc you actually sit with: it whips harder than
 * leadership, it can deny a Speaker a majority on its own, and it is why the
 * ideology picked at creation is now a room you walk into rather than a number.
 */
function factionCard(board) {
  const f = board.faction;
  if (!f) return "";
  const trait = board.trait;
  const standing = board.blocStanding;
  const tone = standing != null && standing < 40 ? " card--alarm" : "";

  return `<div class="card${tone}">
    <div class="card__head">
      <span class="eyebrow">🪧 ${escapeHtml(f.name)}</span>
      <span class="hint">${f.members} members · ${f.share}% of the chamber</span>
    </div>
    <p class="hint" style="margin:6px 0 12px">${escapeHtml(f.creed)}</p>
    ${standing != null ? `<div class="tiles tiles--four" style="margin-bottom:12px">
      ${meter("Your bloc", standing, "How your own wing rates you")}
      ${plain("Its size", `${f.members}`, f.canDenyMajority
        ? "Enough to deny a majority on its own" : "Too small to stop anything alone")}
    </div>` : ""}
    ${trait ? `<div class="whipbox">
      <div class="whipbox__head"><span class="eyebrow">✍️ ${escapeHtml(board.ideology || "Your politics")}</span></div>
      <p class="hint" style="margin:6px 0 0">▲ ${escapeHtml(trait.strength)}</p>
      <p class="hint" style="margin:4px 0 0">▼ ${escapeHtml(trait.limit)}</p>
      ${trait.files ? `<p class="hint" style="margin:4px 0 0">
        ✍ Filing on <b>${escapeHtml(trait.files)}</b> is markedly easier for you than anything else.</p>` : ""}
    </div>` : ""}
    ${board.chamberFactions?.length ? `<div class="flips" style="margin-top:12px">
      ${board.chamberFactions.map((x) => `<span class="flip ${x.id === f.id ? "" : "flip--loss"}">
        ${escapeHtml(x.name.replace(/^The /, ""))}<i>${x.members}</i></span>`).join("")}
    </div>` : ""}
  </div>`;
}

/**
 * Who you represent.
 *
 * A seat used to be a code and a partisan lean — one integer standing in for a
 * few hundred thousand people. This is the place itself, and how far it has
 * moved since the day you were sworn in, which over a long career is the
 * quietest and most consequential thing that happens to a member.
 */
function peopleCard(board) {
  const p = board.people;
  if (!p) return "";
  const shifted = Math.round((p.leanNow - p.leanAtOath) * 10) / 10;
  const lean = (v) => (v > 0 ? `R+${Math.abs(Math.round(v))}` : `D+${Math.abs(Math.round(v))}`);

  return `<div class="card">
    <div class="card__head">
      <span class="eyebrow">👥 Who you represent</span>
      <span class="hint">${lean(p.leanNow)}${
        Math.abs(shifted) >= 1 ? ` · was ${lean(p.leanAtOath)} at your oath` : ""}</span>
    </div>
    <p class="hint" style="margin:6px 0 12px">${escapeHtml(p.describes)}${
      p.wasDescribed && p.wasDescribed !== p.describes
        ? ` — it was ${escapeHtml(p.wasDescribed)} when you arrived.` : "."}</p>
    <div class="people">
      ${p.rows.map((r) => {
        const off = Math.abs(r.deviation) >= 0.8 ? (r.deviation > 0 ? "up" : "down") : "";
        return `<div class="people__cell">
          <span class="people__k">${escapeHtml(r.name)}</span>
          <b class="${off}">${r.value}${escapeHtml(r.unit)}</b>
          <i>national ${Math.round(r.national)}${escapeHtml(r.unit)}</i>
        </div>`;
      }).join("")}
    </div>
    ${Math.abs(shifted) >= 2 ? `<p class="hint" style="margin:12px 0 0">
      <b>The seat has moved ${Math.abs(shifted)} points ${shifted > 0 ? "toward the Republicans" : "toward the Democrats"} since you were sworn in.</b>
      Nobody changed their mind. The people changed.
    </p>` : ""}
  </div>`;
}

/** Which groups in the seat this bill actually lands on. */
function impactBlock(bill) {
  const hits = bill.impact || [];
  if (!hits.length) return "";
  return `<div class="whipbox" style="margin-top:12px">
    <div class="whipbox__head">
      <span class="eyebrow">👥 Who this hits in ${escapeHtml(G.state.seat.district || "your seat")}</span>
    </div>
    <div class="flips" style="margin-top:8px">
      ${hits.map((g) => `<span class="flip ${g.feeling < 0 ? "flip--loss" : ""}">
        ${g.feeling > 0 ? "▲" : "▼"} ${escapeHtml(g.name)}<i>${g.share}% of the seat</i>
      </span>`).join("")}
    </div>
  </div>`;
}

/**
 * Whose votes have come loose.
 *
 * A bloc breaking from its own politics moved the roll call and said nothing —
 * `factionLine` only ever reported the player's own caucus, so with eight
 * factions seven defections in eight happened off-screen. This is the one thing
 * a member standing on the floor would certainly know.
 *
 * The player's own bloc is skipped: it already has a card of its own, and saying
 * it twice reads as two separate defections.
 */
function defectionNote(bill) {
  const others = (bill.defections || []).filter((d) => !d.yours);
  if (!others.length) return "";
  return `<div class="whipbox" style="margin-top:12px">
    <div class="whipbox__head"><span class="eyebrow">⚡ Breaking ranks</span></div>
    ${others.map((d) => `<p class="hint" style="margin:6px 0 0">
      <b>${escapeHtml(d.name)}</b> is voting ${d.position.toUpperCase()} — ${d.members} seat${
        d.members === 1 ? "" : "s"} against where its own politics would put it.${
        d.because ? ` ${escapeHtml(d.because.replace(/^./, (c) => c.toUpperCase()))}.` : ""}
    </p>`).join("")}
  </div>`;
}

/**
 * When all three of them disagree.
 *
 * The mode used to be a two-way bind: your caucus against your district. Adding
 * what you actually believe makes a third case possible, and it is the most
 * interesting vote in the game — there is no way through it that does not cost
 * you something real, which is exactly the position a legislature puts people in.
 */
function threeWayNote(bill) {
  const c = bill.conviction;
  if (!c) return "";
  const positions = new Set([bill.party.position, bill.district.position, c.position]);
  if (positions.size === 1) return "";

  const alone = c.position !== bill.party.position && c.position !== bill.district.position;
  if (alone) {
    return `<p class="hint" style="margin:12px 0 0">
      ⚠️ <b>You are on your own here.</b> Your caucus and ${escapeHtml(bill.district.district || "your seat")}
      agree with each other and not with you. Voting your conscience costs you both at once.
    </p>`;
  }
  const withWhom = c.position === bill.party.position ? "your caucus" : "the people who elected you";
  return `<p class="hint" style="margin:12px 0 0">
    🪞 On this one you are with ${escapeHtml(withWhom)}. The other one is the price.
  </p>`;
}

/** Which of the blocs behind you moved, and which way. */
function blocMoves(blocs) {
  const moved = Object.entries(blocs || {}).filter(([, v]) => Math.abs(v) >= 1);
  if (!moved.length) return "";
  const label = (id) => (BLOC_NAMES[id] || id);
  return `<div class="flips" style="margin-top:12px">
    ${moved.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([id, v]) =>
      `<span class="flip ${v < 0 ? "flip--loss" : ""}">${escapeHtml(label(id))}<i>${v > 0 ? "+" : ""}${Math.round(v)}</i></span>`).join("")}
  </div>`;
}

const BLOC_NAMES = {
  wall_street: "Wall Street", big_business: "Big Business", pentagon: "The Pentagon",
  labor: "Labour", greens: "Environmentalists", civil_rights: "Civil Rights",
  gun_owners: "Gun Owners", faith: "Faith Communities",
};

/**
 * The people who put you here.
 *
 * Seeded from the ideology chosen at creation, which until now bought a starting
 * approval number and nothing else. These are the groups that funded the last
 * campaign and decide whether there is another one.
 */
function coalitionCard(board) {
  const c = board.coalition;
  if (!c) return "";
  const tone = c.mood === "gone" ? " card--alarm" : c.mood === "committed" ? " card--accent" : "";
  return `<div class="card${tone}">
    <div class="card__head">
      <span class="eyebrow">🤝 Who brought you here</span>
      <span class="hint">${escapeHtml(board.ideology || "")} · ${c.mood}</span>
    </div>
    <p class="hint" style="margin:6px 0 12px">${escapeHtml(c.note)}</p>
    <div class="record">
      ${c.rows.map((r) => {
        const tone2 = r.now >= 60 ? "up" : r.now < 45 ? "down" : "";
        return `<div class="record__row" style="grid-template-columns:11rem 1fr 4rem 5rem">
          <span class="record__name">${escapeHtml(r.name)}</span>
          <span class="track"><i style="width:${Math.round(r.now)}%;background:${
            r.now >= 60 ? "var(--green)" : r.now >= 45 ? "var(--amber)" : "var(--red)"}"></i></span>
          <span class="record__to">${Math.round(r.now)}%</span>
          <span class="record__change ${tone2}">${r.change > 0 ? "+" : ""}${r.change} since day one</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

/** Ranks that hold a gavel over their own committee's bills. */
const GAVEL = new Set(["subchair", "chair", "speaker"]);

const stanceClass = (p) => (p === "yes" ? "stance--yes" : "stance--no");

/**
 * How contested this one is, said out loud.
 *
 * Worth its own line because it is the difference between a vote of 54-46 and
 * one of 87-13, and until it existed the two were indistinguishable on screen:
 * a bill nobody wanted to be recorded against looked exactly like a party-line
 * tax cut, and both were counted as one.
 */
const SUPPORT_NOTE = {
  unanimous: ["🕊️", "Nobody will be recorded against this. The vote is a formality; being absent for it is not."],
  bipartisan: ["🤝", "Not a party-line vote. Both sides want the purpose even where they argue about the amount."],
  contested: ["↔️", "Some of the other side will cross over on this one."],
};

function supportNote(bill) {
  const note = SUPPORT_NOTE[bill.support];
  if (!note) return "";
  const [icon, text] = note;
  return `<p class="hint" style="margin:0 0 14px">
    ${icon} <b>${bill.support === "unanimous" ? "Unanimous" : bill.support === "bipartisan" ? "Bipartisan" : "Crosses the aisle"}.</b>
    ${escapeHtml(text)}${bill.crisis ? ` The chamber has closed ranks over ${escapeHtml(bill.crisis)}.` : ""}
  </p>`;
}

function billCard(bill) {
  const split = bill.party.position !== bill.district.position;
  return `<div class="card${bill.fringe || split ? " card--alarm" : ""}" data-bill="${escapeHtml(bill.id)}">
    <div class="card__head">
      <span class="eyebrow">${bill.fringe
        ? `🔥 ${bill.axis < 0 ? "The far left" : "The far right"} has the floor`
        : split ? "⚔️ They disagree" : "🤝 They agree"}</span>
      <span class="hint">${escapeHtml(bill.domain)}</span>
    </div>
    ${bill.fringe ? `<p class="hint" style="margin:6px 0 0">
      This is not an ordinary bill. It would not adjust the settlement, it would replace it —
      and there is no way to vote on it that nobody remembers.
    </p>` : ""}
    <h3 class="display display--sm" style="margin:4px 0 6px">${escapeHtml(bill.title)}</h3>
    <p class="brief__body" style="margin:0 0 ${bill.because || bill.sponsor ? "10px" : "14px"}">${escapeHtml(bill.brief || "")}</p>
    ${bill.because || bill.sponsor ? `<p class="hint" style="margin:0 0 10px">
      ${bill.sponsor ? `Filed by ${escapeHtml(bill.sponsor)}.` : ""}
      ${bill.because ? `<b>Why it is on the floor:</b> ${escapeHtml(bill.because)}.` : ""}
    </p>` : ""}
    ${supportNote(bill)}

    <div class="stances${bill.bloc ? " stances--four" : bill.conviction ? " stances--three" : ""}">
      <div class="stance ${stanceClass(bill.party.position)}">
        <span class="stance__who">${G.state.independent ? escapeHtml(G.state.caucus) + " caucus" : "Your leadership"}</span>
        <span class="stance__pos">${bill.party.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(bill.party.reason)}</span>
        <span class="stance__heat">Pressure ${bill.party.intensity}</span>
      </div>
      <div class="stance ${stanceClass(bill.district.position)}">
        <span class="stance__who">${escapeHtml(bill.district.district || G.state.seat.district)}</span>
        <span class="stance__pos">${bill.district.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(bill.district.reason)}</span>
        <span class="stance__heat">Pressure ${bill.district.intensity}</span>
      </div>
      ${bill.bloc ? `<div class="stance stance--bloc ${stanceClass(bill.bloc.position)}">
        <span class="stance__who">${escapeHtml(bill.bloc.name)}</span>
        <span class="stance__pos">${bill.bloc.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(bill.bloc.reason)}</span>
        <span class="stance__heat">Discipline ${Math.round(bill.bloc.discipline * 100)} · ${bill.bloc.intensity}</span>
      </div>` : ""}
      ${bill.conviction ? `<div class="stance stance--you ${stanceClass(bill.conviction.position)}">
        <span class="stance__who">You${bill.conviction.fringe ? " ⚑" : ""}</span>
        <span class="stance__pos">${bill.conviction.position.toUpperCase()}</span>
        <span class="stance__note">${escapeHtml(bill.conviction.reason)}</span>
        <span class="stance__heat">${escapeHtml(bill.conviction.ideology)} · ${bill.conviction.intensity}</span>
      </div>` : ""}
    </div>
    ${impactBlock(bill)}
    ${defectionNote(bill)}
    ${threeWayNote(bill)}
    <p class="hint" style="margin:12px 0 0">${escapeHtml(bill.district.pressureNote || "")}</p>

    ${whipBox(bill)}

    ${bill.yours && GAVEL.has(G.state.rank) ? `<div class="gavel">
      <span class="eyebrow">⚖️ Your committee's jurisdiction</span>
      <p class="hint" style="margin:6px 0 10px">This is yours before it is anybody else's.</p>
      <div class="btn-row" style="justify-content:flex-start">
        ${G.state.rank === "chair" || G.state.rank === "speaker"
          ? `<button class="btn btn--danger btn--sm" data-gavel="bury">Bury it in committee</button>` : ""}
        <button class="btn btn--sm" data-gavel="amend">Report it out amended</button>
      </div>
    </div>` : ""}

    ${G.state.office === "senate" && !bill.filibustered ? `<div class="gavel">
      <span class="eyebrow">🗣️ Hold the floor</span>
      <p class="hint" style="margin:6px 0 10px">
        Any senator can filibuster. It puts the bar at ${board.cloture} votes instead of 51 —
        and leadership will know exactly who made them find them.
      </p>
      <button class="btn btn--sm" data-filibuster="1">Filibuster it</button>
    </div>` : ""}
    ${bill.filibustered ? `<p class="hint" style="margin:12px 0 0">
      <b>You are holding the floor.</b> This needs ${board.cloture} votes to proceed.</p>` : ""}

    <div class="btn-row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn" data-vote="abstain">Abstain</button>
      <button class="btn btn--danger" data-vote="no">Vote No</button>
      <button class="btn btn--primary" data-vote="yes">Vote Aye</button>
    </div>
    <div class="vote-result hidden"></div>
  </div>`;
}

/**
 * Calling in what you are owed.
 *
 * Two separate things that used to be one, and that was the whole problem.
 *
 * *The count* is a whip's private knowledge — everybody else votes on a guess,
 * and that is most of what the job is worth. It stays gated.
 *
 * *Spending* is now anybody's, because a member who has banked favours on every
 * party-line vote for two years and cannot call in one of them is holding a
 * number rather than a currency. A backbencher spends blind and moves two or
 * three votes; a whip spends knowing the number and moves a bloc. That is the
 * honest difference between the ranks, and it reads better than the old one,
 * which was that the backbencher had no hand at all.
 */
function whipBox(bill) {
  const capital = Math.round(G.state.capital || 0);
  const count = bill.whip?.visible ? bill.whip : null;
  // Nothing to say: no count to show and nothing banked to spend.
  if (!count && capital < 1) return "";
  // A whip who already has it does not need to buy anything.
  if (count?.passing) return countBlock(count, "");

  const spend = `<div class="whipbox__act">
    <input type="range" min="0" max="${capital}" value="0" data-whip-range />
    <span class="hint" data-whip-label>Call in 0 favours</span>
    <button class="btn btn--sm" data-whip-go>Work the floor</button>
  </div>`;

  if (count) return countBlock(count, spend);

  // No count, but favours to spend. Say plainly that this is a gamble.
  return `<div class="whipbox">
    <div class="whipbox__head">
      <span class="eyebrow">🤝 Favours you are owed</span>
      <b>${capital}</b>
    </div>
    <p class="hint" style="margin:6px 0 0">
      You cannot see the count — only a Whip walks in knowing it. Call in what you are owed
      and you will move a vote or two without knowing whether it was the vote that mattered.
    </p>
    ${spend}
  </div>`;
}

const countBlock = (count, spend) => `<div class="whipbox">
  <div class="whipbox__head">
    <span class="eyebrow">🔢 The count</span>
    <b class="${count.passing ? "up" : "down"}">${count.yes}–${count.no}</b>
  </div>
  <p class="hint" style="margin:6px 0 0">${escapeHtml(count.note)}</p>
  ${spend}
</div>`;

/** Primaries, and the circuit. */
function wireParty() {
  const card = $("partyCard");
  if (!card) return;
  const run = async (fn, busy, confirmWith) => {
    if (confirmWith && !confirm(confirmWith)) return;
    loader(true, busy);
    try {
      const data = await fn();
      G.state = data.state;
      saveCareer();
      alert(data.note);
      renderFloor(handlers);
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };

  card.onclick = (e) => {
    const pick = e.target.closest("[data-endorse]");
    if (pick) {
      return run(() => endorseAgainst(G.state, pick.dataset.endorse),
        "You are making the call…",
        "Endorse a challenger against a member of your own party? Leadership will never forget it.");
    }
    if (e.target.closest("[data-fundraise]")) {
      return run(() => raiseForColleagues(G.state), "Three states in four days…");
    }
  };
}

/** Casework and the project. */
function wireDistrict() {
  const card = $("districtCard");
  if (!card) return;
  const run = async (fn, busy) => {
    loader(true, busy);
    try {
      const data = await fn();
      G.state = data.state;
      saveCareer();
      alert(data.note);
      renderFloor(handlers);
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };

  const range = card.querySelector("[data-case-range]");
  if (range) {
    const label = card.querySelector("[data-case-label]");
    range.oninput = () => {
      label.textContent = `${range.value} day${range.value === "1" ? "" : "s"} a week in the district`;
    };
    card.querySelector("[data-case-go]").onclick =
      () => run(() => doCasework(G.state, Number(range.value)), "Your office is making calls…");
  }
  const ear = card.querySelector("[data-earmark]");
  if (ear) ear.onclick = () => run(() => askEarmark(G.state), "You are asking for it…");
}

/** Calling a witness. */
function wireHearing() {
  const card = $("hearingCard");
  if (!card) return;
  card.onclick = async (e) => {
    const btn = e.target.closest("[data-hear]");
    if (!btn) return;
    loader(true, "The committee is coming to order…");
    try {
      const data = await callHearing(G.state, btn.dataset.hear, btn.dataset.compel === "1");
      G.state = data.state;
      saveCareer();
      alert(data.note);
      renderFloor(handlers);
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };
}

/** The motion, and what it costs to lose. */
function wireVacate() {
  const card = $("vacateCard");
  if (!card) return;
  const range = card.querySelector("[data-vac-range]");
  const label = card.querySelector("[data-vac-label]");
  range.oninput = () => {
    label.textContent = `Call in ${range.value} favour${range.value === "1" ? "" : "s"}`;
  };
  card.querySelector("[data-vac-go]").onclick = async () => {
    if (!confirm("Move to vacate the chair? Win or lose, your own leadership will know it was you.")) return;
    loader(true, "The clerk is reading the motion…");
    try {
      const data = await moveVacate(G.state, Number(range.value));
      G.state = data.state;
      saveCareer();
      alert(data.note);
      renderFloor(handlers);
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };
}

/** The shelf and the signature drive. */
function wirePetition() {
  const card = $("petitionCard");
  if (!card) return;

  card.onclick = async (e) => {
    const pick = e.target.closest("[data-petition]");
    if (!pick) return;
    loader(true, "Filing the paperwork…");
    try {
      const data = await filePetition(G.state, pick.dataset.petition, 0);
      G.state = data.state;
      saveCareer();
      renderFloor(handlers);
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };

  const range = card.querySelector("[data-pet-range]");
  if (!range) return;
  const label = card.querySelector("[data-pet-label]");
  range.oninput = () => {
    label.textContent = `Call in ${range.value} favour${range.value === "1" ? "" : "s"}`;
  };
  card.querySelector("[data-pet-go]").onclick = async () => {
    loader(true, "You are making calls…");
    try {
      const data = await pushPetition(G.state, Number(range.value));
      G.state = data.state;
      saveCareer();
      renderFloor(handlers);
    } catch (err) {
      alert(err.message);
    } finally { loader(false); }
  };
}

function wireBill(bill) {
  const card = document.querySelector(`[data-bill="${bill.id}"]`);
  if (!card) return;
  let live = bill;   // the bill as it now stands, if committee amended it

  const range = card.querySelector("[data-whip-range]");
  if (range) {
    const label = card.querySelector("[data-whip-label]");
    range.oninput = () => { label.textContent = `Call in ${range.value} favour${range.value === "1" ? "" : "s"}`; };
    card.querySelector("[data-whip-go]").onclick = async () => {
      loader(true, "You are making calls…");
      try {
        const data = await chamber().whip(G.state, live, Number(range.value));
        G.state = data.state;
        saveCareer();
        renderFloor(handlers);
      } catch (err) {
        // A spend too small to move anybody is refused rather than wasted, and
        // the message names the price — worth showing, not swallowing.
        alert(err.message);
      } finally { loader(false); }
    };
  }

  const fil = card.querySelector("[data-filibuster]");
  if (fil) {
    fil.onclick = async () => {
      loader(true, "You have the floor…");
      try {
        const data = await senateFilibuster(G.state, live);
        G.state = data.state;
        saveCareer();
        renderFloor(handlers);
      } catch (err) {
        alert("The floor could not be held: " + err.message);
      } finally { loader(false); }
    };
  }

  for (const g of card.querySelectorAll("[data-gavel]")) {
    g.onclick = async () => {
      loader(true, "The committee is marking it up…");
      try {
        const data = await chamber().committee(G.state, live, g.dataset.gavel);
        G.state = data.state;
        saveCareer();
        if (data.result.buried) return renderFloor(handlers);
        live = data.result.bill;
        renderFloor(handlers);
      } catch (err) {
        alert("The committee could not act: " + err.message);
      } finally { loader(false); }
    };
  }

  card.onclick = async (e) => {
    const btn = e.target.closest("[data-vote]");
    if (!btn) return;
    for (const b of card.querySelectorAll("[data-vote]")) b.disabled = true;
    loader(true, "The clerk is calling the roll…");
    try {
      const data = await chamber().vote(G.state, live, btn.dataset.vote);
      G.state = data.state;
      saveCareer();
      paintVoteResult(card, data.result);
    } catch (err) {
      alert("The vote could not be recorded: " + err.message);
      for (const b of card.querySelectorAll("[data-vote]")) b.disabled = false;
    } finally {
      loader(false);
    }
  };
}

function paintVoteResult(card, result) {
  card.querySelector(".btn-row")?.remove();
  const box = card.querySelector(".vote-result");
  const t = result.tally;
  const delta = (v) => `<b class="${v >= 0 ? "up" : "down"}">${v > 0 ? "+" : ""}${v}</b>`;

  box.className = "vote-result";
  box.innerHTML = `
    <div class="vote-result__head">
      <span class="badge ${result.passed ? "badge--live" : "badge--red"}">
        ${result.passed ? "Passed" : "Failed"} ${t.yes}–${t.no}</span>
      <span class="hint">You voted <b>${result.yourVote.toUpperCase()}</b></span>
    </div>
    <p style="margin:10px 0 0">${escapeHtml(result.note)}</p>
    <div class="vote-result__deltas">
      <span>District ${delta(result.district.delta)}</span>
      <span>Leadership ${delta(result.party.delta)}</span>
      ${result.conviction ? `<span>Integrity ${delta(result.conviction.delta)}</span>` : ""}
      ${result.bloc ? `<span>Your bloc ${delta(result.bloc.delta)}</span>` : ""}
    </div>
    ${result.conviction?.note
      ? `<p class="hint" style="margin:10px 0 0"><b>🪞 ${escapeHtml(result.conviction.note)}</b></p>` : ""}
    ${result.bloc?.note
      ? `<p class="hint" style="margin:8px 0 0"><b>🪧 ${escapeHtml(result.bloc.note)}</b></p>` : ""}
    ${blocMoves(result.blocs)}
    ${falloutBlock(result.fallout)}`;
  // The two headline numbers moved; keep the tiles honest.
  refreshMeters();
}

function refreshMeters() {
  const set = (id, v) => {
    const el = $(id);
    if (el) el.textContent = `${Math.round(v)}%`;
  };
  set("meterYourDistrict", G.state.approval);
  set("meterYourLeadership", G.state.leadership);
}

// --- Your own bill ----------------------------------------------------------

const DOMAINS = ["economy", "health", "security", "justice", "social"];

function sponsorCard() {
  return `<div class="card" id="sponsorCard">
    <span class="eyebrow">📋 File your own bill</span>
    <p class="hint" style="margin:8px 0 14px">
      Most bills die in committee, and a freshman's die faster. Getting one heard is what
      seniority and leadership goodwill actually buy.
    </p>
    <input id="sponsorTitle" type="text" maxlength="80" placeholder="The name it will be known by…" />
    <div class="sponsor-row">
      <label class="sponsor-field">
        <span class="hint">Where it sits</span>
        <input id="sponsorAxis" type="range" min="-100" max="100" value="${Math.round((Number(G.state.scenario.ideologyAxis) || 0) * 100)}" />
        <span class="hint" id="sponsorAxisLabel"></span>
      </label>
      <label class="sponsor-field">
        <span class="hint">Domain</span>
        <select id="sponsorDomain">
          ${DOMAINS.map((d) => `<option value="${d}">${d}</option>`).join("")}
        </select>
      </label>
      <button class="btn btn--primary" id="sponsorGo">File It</button>
    </div>
    ${Math.round(G.state.capital || 0) >= 1 ? `
      <div class="whipbox" style="margin-top:14px">
        <div class="whipbox__head">
          <span class="eyebrow">🤝 Call in favours to get it heard</span>
          <b>${Math.round(G.state.capital)} owed</b>
        </div>
        <p class="hint" style="margin:6px 0 0">
          This is what the party-line votes were for. Almost every bill dies in committee;
          favours are how yours gets a hearing instead.
        </p>
        <div class="whipbox__act">
          <input type="range" min="0" max="${Math.round(G.state.capital)}" value="0" id="sponsorFavours" />
          <span class="hint" id="sponsorFavoursLabel">Call in 0 favours</span>
        </div>
      </div>` : ""}
    <div class="vote-result hidden" id="sponsorResult"></div>
  </div>`;
}

function wireSponsor() {
  const axis = $("sponsorAxis");
  const label = () => {
    const v = Number(axis.value) / 100;
    $("sponsorAxisLabel").textContent = v < -0.55 ? "Hard left"
      : v < -0.15 ? "Left" : v <= 0.15 ? "Centre" : v <= 0.55 ? "Right" : "Hard right";
  };
  axis.oninput = label;
  label();

  // What the favours are buying, priced live so the trade is legible before it
  // is made rather than explained after it.
  const favours = $("sponsorFavours");
  if (favours) {
    const flabel = $("sponsorFavoursLabel");
    const price = () => {
      const n = Number(favours.value);
      const push = n ? Math.min(30, Math.floor(Math.sqrt(n) * 3.2)) : 0;
      flabel.textContent = n
        ? `Call in ${n} favour${n === 1 ? "" : "s"} — about +${push} to the odds of a hearing`
        : "Call in 0 favours";
    };
    favours.oninput = price;
    price();
  }

  $("sponsorGo").onclick = async () => {
    const title = $("sponsorTitle").value.trim() || "An Act";
    loader(true, "It has been referred to committee…");
    try {
      const data = await chamber().sponsor(G.state, title, Number(axis.value) / 100,
        $("sponsorDomain").value, favours ? Number(favours.value) : 0);
      G.state = data.state;
      saveCareer();
      const box = $("sponsorResult");
      box.className = "vote-result";
      box.innerHTML = `
        <div class="vote-result__head">
          <span class="badge ${data.result.passed ? "badge--live" : data.result.reachedFloor ? "badge--amber" : "badge--red"}">
            ${data.result.passed ? `Passed the ${chamber().chamberName}` : data.result.reachedFloor ? "Got a vote" : "Died in committee"}</span>
          <span class="hint">${data.result.odds}% chance of a hearing${
            data.result.push ? ` · +${data.result.push} from ${data.result.favours} favours` : ""}</span>
        </div>
        <p style="margin:10px 0 0">${escapeHtml(data.result.note)}</p>`;
      $("sponsorGo").disabled = true;
      refreshMeters();
    } catch (err) {
      alert("The bill could not be filed: " + err.message);
    } finally {
      loader(false);
    }
  };
}

// --- Ending the month -------------------------------------------------------

async function endMonth() {
  loader(true, G.state.month >= chamber().term
    ? "The polls are closing…" : `The ${chamber().chamberName} adjourns…`);
  try {
    const data = await chamber().advance(G.state);
    G.state = data.state;
    saveCareer();
    // A career on the ladder is asked what it wants next once the district has
    // answered; one without an envelope keeps the behaviour it always had.
    if (data.reelection) {
      return handlers.onElection(data.reelection, data.ladder, data.cycle, data.choices);
    }
    // A senator sits through two elections they are not in. They still need to
    // be told what happened in them — it may have just cost them a gavel.
    if (data.cycle) pendingCycle = { cycle: data.cycle, ladder: data.ladder };
    renderFloor(handlers);
  } catch (err) {
    alert("The month could not be closed out: " + err.message);
  } finally {
    loader(false);
  }
}

// --- Bits -------------------------------------------------------------------

const meterId = (label) => "meter" + label.replace(/[^a-zA-Z]/g, "");

function meter(label, value, sub) {
  const v = Math.round(value);
  const tone = v >= 55 ? "var(--green)" : v >= 40 ? "var(--amber)" : "var(--red)";
  return `<div class="tile">
    <span class="eyebrow">${escapeHtml(label)}</span>
    <div class="tile__value" id="${meterId(label)}">${v}%</div>
    <div class="tile__delta">&nbsp;</div>
    <div class="tile__sub">${escapeHtml(sub)}</div>
    <div class="track"><i style="width:${v}%;background:${tone}"></i></div>
  </div>`;
}

const plain = (label, value, sub) => `<div class="tile">
  <span class="eyebrow">${escapeHtml(label)}</span>
  <div class="tile__value">${escapeHtml(String(value))}</div>
  <div class="tile__delta">&nbsp;</div>
  <div class="tile__sub">${escapeHtml(sub)}</div>
</div>`;

const forecastLabel = (f) => (f.margin > 12 ? "Safe" : f.margin > 3 ? "Likely" : f.margin > -3 ? "Toss-up" : f.margin > -12 ? "Behind" : "Lost");

const forecastNote = (f) =>
  `${f.margin > 0 ? "+" : ""}${f.margin} today · ${f.sameParty ? "running on the President's record" : "running against the President"}`;
