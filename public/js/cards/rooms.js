import { $, show, escapeHtml, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { roomsBoard, roomOpen, roomAnswer } from "../api.js";

/**
 * The month, as a building you walk around.
 *
 * A term used to be forty-eight repetitions of one gesture — read the
 * dashboard, press Play, write a policy — and everything else the office
 * involves was met only in its consequences. You could serve four years without
 * taking a single question.
 *
 * So the six standing appointments of the presidency sit on the dashboard next
 * to the statistics, each showing what is waiting in it this month and how long
 * since you were last in. None of them is compulsory. Ending the month having
 * done none of them is a real strategy, for exactly as long as it works.
 */

let board = [];
let hooks = {};

/**
 * What the month is about, which the two modes keep in different places.
 *
 * The presidency holds its situation client-side and posts it with every
 * request; a member's is on the career itself, put there by the nation engine.
 * Every room reads it — the Situation Room is about it, and the press rooms in
 * both buildings ask about it.
 */
const LEGISLATURES = new Set(["house", "senate", "statehouse"]);
const currentEvent = () => (LEGISLATURES.has(G.state?.office) ? G.state.situation || null : G.event);

export async function loadRooms(state, event) {
  try {
    const data = await roomsBoard(state, event);
    board = data.rooms || [];
  } catch {
    board = [];
  }
  return board;
}

/** The urgency of what is waiting, which is not the same as the risk of missing it. */
const URGENCY_TONE = ["", "", "var(--amber)", "var(--red)"];

export function roomsCard() {
  if (!board.length) return "";
  const outstanding = board.filter((r) => !r.done).length;

  return `<div class="card" id="roomsCard">
    <div class="card__head">
      <span class="eyebrow">🗓️ ${LEGISLATURES.has(G.state?.office) ? "Your week" : "Your month"}</span>
      <span class="hint">${outstanding
        ? `${outstanding} of ${board.length} still open`
        : "Everything on the schedule is done"}</span>
    </div>
    <p class="hint" style="margin:6px 0 12px">
      None of it is compulsory. All of it is being noticed.
    </p>
    <div class="rows">
      ${board.map((room) => {
        const risk = Math.round(room.risk * 100);
        return `<button class="career office${room.done ? " office--done" : ""}"
          data-room="${escapeHtml(room.id)}"${room.done ? " disabled" : ""}>
          <span class="office__text">
            <span class="office__title">${room.emoji} ${escapeHtml(room.name)}${
              room.done ? " ✓" : ""}</span>
            <span class="office__lede">${escapeHtml(room.line)}</span>
            <span class="office__lede" style="color:${URGENCY_TONE[room.urgency] || "inherit"}">
              ${escapeHtml(room.since)}${risk
                ? ` · <b>${risk}%</b> chance this is the month it costs you`
                : ""}
            </span>
          </span>
          <span class="career__go">${room.done ? "" : "▸"}</span>
        </button>`;
      }).join("")}
    </div>
  </div>`;
}

export function wireRooms(handlers) {
  hooks = handlers;
  const card = $("roomsCard");
  if (!card) return;
  card.onclick = async (e) => {
    const pick = e.target.closest("[data-room]");
    if (!pick || pick.disabled) return;
    await enterRoom(pick.dataset.room);
  };
}

// --- Inside ------------------------------------------------------------------

let session = null;

async function enterRoom(id) {
  const room = board.find((r) => r.id === id);
  loader(true, `They are waiting for you in ${room ? room.name.toLowerCase() : "the room"}…`);
  try {
    const data = await roomOpen(G.state, id, currentEvent());
    session = { id, room, opening: data.opening };
    renderSession();
  } catch (err) {
    alert(err.message);
  } finally { loader(false); }
}

function renderSession() {
  const { room, opening } = session;
  $("turnBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${room.emoji} ${escapeHtml(room.name)}</h1>
        <div class="dash-head__sub">${escapeHtml(room.who)}</div>
      </div>
    </div>

    <div class="card card--accent">
      <p class="brief__body" style="margin:0">${escapeHtml(opening.scene)}</p>
    </div>

    ${opening.voices.length ? `<div class="card">
      <div class="rows">
        ${opening.voices.map((v) => `<div class="career office" style="cursor:default">
          <span class="office__text">
            <span class="office__title">${escapeHtml(v.who)}</span>
            <span class="office__lede">“${escapeHtml(v.line)}”</span>
          </span>
        </div>`).join("")}
      </div>
    </div>` : ""}

    ${opening.options?.length ? `<div class="card">
      <span class="eyebrow">📋 What they are recommending</span>
      <p class="hint" style="margin:6px 0 12px">
        Take one and it becomes your answer — edit it first if you like. None of them is
        the right one, and the people who wrote them are the people you appointed.
      </p>
      <div class="rows">
        ${opening.options.map((o) => `<button class="career office" data-plan="${escapeHtml(o.id)}">
          <span class="office__text">
            <span class="office__title">${o.emoji || "🗣️"} ${escapeHtml(o.who)}</span>
            <span class="office__lede">“${escapeHtml(o.plan)}”</span>
          </span>
          <span class="career__go">▸</span>
        </button>`).join("")}
      </div>
    </div>` : ""}

    <div class="card composer">
      <span class="eyebrow">${escapeHtml(opening.asks || room.invite)}</span>
      <textarea id="roomInput" rows="6" maxlength="1600"
        placeholder="In your own words, or take one of theirs…"></textarea>
      <div class="composer__actions">
        <span class="composer__count" id="roomCount">0 / 1600</span>
        <div class="btn-row">
          <button class="btn" id="roomBack">← Leave it</button>
          <button class="btn btn--primary" id="roomGo">Say it →</button>
        </div>
      </div>
    </div>`;

  const input = $("roomInput");
  input.oninput = () => { $("roomCount").textContent = `${input.value.length} / 1600`; };
  $("roomGo").onclick = answer;
  $("roomBack").onclick = () => hooks.onDashboard?.();

  /**
   * Taking an advisor's plan fills the box rather than sending it.
   *
   * One code path for answering, and — more to the point — the player gets to
   * put their own sentence on the end of somebody else's plan before it goes on
   * the record, which is most of what a president does with advice.
   */
  document.querySelector("[data-plan]")?.closest(".rows")?.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-plan]");
    if (!pick) return;
    const chosen = (opening.options || []).find((o) => o.id === pick.dataset.plan);
    if (!chosen) return;
    input.value = chosen.plan;
    input.dispatchEvent(new Event("input"));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  show("turn");
  input.focus();
}

async function answer() {
  const input = $("roomInput");
  const text = input.value.trim();
  if (text.length < 3) {
    input.focus();
    input.style.borderColor = "var(--red)";
    setTimeout(() => (input.style.borderColor = ""), 900);
    return;
  }

  loader(true, "The room is reacting…");
  try {
    const data = await roomAnswer(G.state, session.id, session.opening, text, currentEvent());
    G.state = data.state;
    saveCareer();
    renderReaction(data.verdict, data.applied);
  } catch (err) {
    alert(err.message);
  } finally { loader(false); }
}

const SCORE_WORD = {
  "-3": "A disaster", "-2": "Badly", "-1": "Poorly",
  0: "Neutrally", 1: "Well", 2: "Very well", 3: "Remarkably",
};

const delta = (n) => `<b class="${n >= 0 ? "up" : "down"}">${n > 0 ? "+" : ""}${n}</b>`;

function renderReaction(verdict, applied) {
  const moved = Object.entries(applied?.moved || {});
  $("turnBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${session.room.emoji} ${escapeHtml(session.room.name)}</h1>
        <div class="dash-head__sub">${SCORE_WORD[String(applied?.score ?? 0)] || "Neutrally"} received</div>
      </div>
    </div>

    <div class="card ${applied?.score < 0 ? "card--alarm" : "card--accent"}">
      <p class="brief__body" style="margin:0">${escapeHtml(verdict.reaction)}</p>
      ${moved.length ? `<div class="vote-result__deltas" style="margin-top:12px">
        ${moved.map(([k, v]) => `<span>${escapeHtml(LABEL[k] || k)} ${delta(v)}</span>`).join("")}
      </div>` : ""}
    </div>

    ${verdict.voices.length ? `<div class="card">
      <div class="rows">
        ${verdict.voices.map((v) => `<div class="career office" style="cursor:default">
          <span class="office__text">
            <span class="office__title">${escapeHtml(v.who)}</span>
            <span class="office__lede">“${escapeHtml(v.line)}”</span>
          </span>
        </div>`).join("")}
      </div>
    </div>` : ""}

    <div class="card">
      <div class="btn-row">
        <button class="btn btn--primary" id="roomDone">Back to the schedule →</button>
      </div>
    </div>`;

  $("roomDone").onclick = () => hooks.onDashboard?.();
}

const LABEL = {
  approval: "Approval", stability: "Stability",
  party: "Your party", warChest: "War chest ($M)",
};
