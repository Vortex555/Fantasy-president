import { complete, aiAvailable } from "./ai/provider.js";
import { parseModelJson } from "./ai/json.js";
import { ENGLISH_ONLY } from "./ai/english.js";
import { seeded } from "./rng.js";
import { roomById, advisorsFor } from "./rooms.js";
import { stateSummary } from "./claude.js";
import { nationSummary } from "./nation.js";
import { withoutRealOutlet } from "./ai/prose.js";

/**
 * What is said in the room.
 *
 * Two calls per session and never more. The first opens the room — the
 * questions the press has, the argument the cabinet is having, what the
 * leadership wants for its votes — and the second is what the room made of the
 * president's answer. Between them the player writes, in their own words, which
 * is the interaction this whole game is built on.
 *
 * The model judges and never decides. It hands back one number between -3 and
 * +3 for how the room took it, exactly as the debate scorer has always done,
 * and rooms.js turns that into what it cost. Ask a model for approval points
 * and it will give you eleven of them.
 *
 * Every room also has a written version of itself. A sleeping GPU must never be
 * the reason a president cannot hold a press conference, so an unreachable
 * model costs the session its specificity and nothing else.
 */

export const roomsAiAvailable = aiAvailable;

/**
 * The same rules, in two buildings.
 *
 * A member is not a president and the prompt must not say they are — told it
 * was writing for the President, a model will have the caseworkers briefing the
 * leader of the free world about a passport. Only the office and the word for
 * the player change, so they are parameterised rather than duplicated.
 */
function houseRules(state) {
  const member = state?.office === "house" || state?.office === "senate"
    || state?.office === "statehouse";
  const who = member
    ? (state.office === "senate" ? "a United States Senator"
      : state.office === "statehouse"
        ? `a member of the ${state.seat?.stateName || "state"} House of Representatives — a state legislator, not a member of Congress`
        : "a member of the United States House of Representatives")
    : "the President of the United States";
  const them = member ? "the member" : "the President";

  return `You are writing one scene in "Fantasy President," a serious, non-partisan political strategy game. The player is ${who}.

Rules that hold in every room:
- Never break character, never mention that this is a game, and never speak as ${them} — they write their own words.
- Invent every name. No real politicians, officials, journalists or organisations.
- These people have their own interests and are not impressed by default. Deference is boring and dishonest; so is contempt for its own sake.
- Be concrete. Name the programme, the number, the town, the deadline. A question or a complaint that would fit any month of any career is a wasted line.
- The player's gender is not stated anywhere and you must not guess it. Use their surname, their title, or they/them.
- ${ENGLISH_ONLY}`;
}

/**
 * What each room is, in the second person, to a model that has to play it.
 *
 * Written as a brief for an actor rather than a specification, because that is
 * what produces a room with a temperature. The instruction that does the most
 * work in every one of them is the last: say what is wanted, not what should be
 * done about it. A room that hands the president its own conclusion has
 * answered the question the player is supposed to answer.
 */
const ROOM_BRIEF = {
  situation: `THE ROOM: the Situation Room. Uniformed officers, agency heads, the Chief of Staff. They have options and no authority. Open with the state of play in three sentences and then the decision that cannot be deferred past today — including the one option nobody wants to say out loud.`,
  press: `THE ROOM: the White House briefing room. Invent two or three correspondents, each from an outlet you have also invented — never a real news organisation, and that includes the wire services and the networks — and give each one question. They are not hostile for sport; they are working, they have talked to your staff already, and at least one of them has something you would rather they did not have. Questions are one sentence each.`,
  cabinet: `THE ROOM: the cabinet table. Two of the secretaries you are given want opposite things and both are partly right; say what each of them wants and what it costs the other. If somebody in the room has been briefing against the President, let it show without stating it outright.`,
  hill: `THE ROOM: a meeting with the leadership of both chambers. They can count and the President cannot. Say what will actually pass, what will not, and the price of the difference — a committee, a nomination, a project in somebody's state. Leadership never says no; it says what it would take.`,
  brief: `THE ROOM: the President's Daily Brief, read aloud by the DNI. Three items. Two are the kind of thing that never becomes anything, and one is next month's crisis if nobody acts. Do not flag which is which — the President is supposed to be able to tell.`,
  district: `THE ROOM: the member's own district office, on a Friday. Caseworkers, a waiting room, and a stack of letters about a passport, a veteran's benefits and somebody's mother. This is not politics; it is the part of the job that decides whether the seat still recognises them. Name real cases with real names.`,
  committee: `THE ROOM: a committee hearing or markup. A witness who has been prepared, a chair with a schedule, and five minutes of questions per member. Say what the witness is trying not to say and what the amendment on the table would actually do.`,
  caucus: `THE ROOM: the weekly caucus meeting. Leadership, the whip, and two hundred colleagues who all want something. Say what the leadership is asking for this week, what it is worth, and who is being leaned on. Nobody in here is interested in principle; they are interested in the count.`,
  cloakroom: `THE ROOM: the cloakroom off the floor. Two or three colleagues, invented, each with something they want and something they can give. This is where the trade is made — a signature, a hearing, a project in somebody's district. Nothing here is written down.`,
  localpress: `THE ROOM: the county paper and the drive-time radio show. Invent the outlet and the reporter, and never a real one. They are not national press: they want to know what a vote means for one specific town, and they will quote the member at length whatever they say.`,
  road: `THE ROOM: a day out of Washington. The state party, the donors, and a room of people who knocked doors. They want to know what happened to the thing they were promised, and one of them asks it in front of a camera.`,
};

/** How the room's answer is scored, in that room's own terms. */
const JUDGE_BRIEF = {
  situation: "Did they actually decide, and does the decision survive contact with the constraint they were given? A president who restates the problem eloquently has not decided anything. BEFORE SCORING, CHECK WHAT THEY DECIDED IS ABOUT: an answer that gives crisp, specific, well-staffed orders about something the room did not ask about is not a good answer, it is a president who is not listening, and it scores worse than a vague answer to the right question. This is the mistake most often made here — a confident answer reads as a good one.",
  press: "Did they answer the questions asked, or the questions they wished had been asked? Evasion is sometimes correct and always costs something. A lie that the room can already disprove is the worst answer available.",
  cabinet: "Did they settle it? Backing one secretary against another is a decision with a cost and is worth more than a synthesis that leaves both of them thinking they won.",
  hill: "Did they pay a real price for a real vote, or ask for cooperation as though it were owed to them? Leadership respects arithmetic and nothing else.",
  brief: "Did they notice the item that mattered and ask about it, or work through all three politely? The whole test is what they picked out.",
  district: "Did they take the cases seriously as cases, or as politics? A member who talks about their legislative agenda in their own district office has misread the room entirely.",
  committee: "Did they ask a question that gets an answer, or make a speech with a question mark on the end? The second is the commonest thing that happens in a committee room and it is worth nothing.",
  caucus: "Did they say what they will actually do, in a room that counts? Leadership can tell the difference between a yes and a member being agreeable, and only one of them is worth anything.",
  cloakroom: "Did they trade something real, or ask for a favour and offer nothing? A member who does not know what they are offering leaves with nothing.",
  localpress: "Did they explain it in terms of the place, or in terms of Washington? A correct answer in the wrong language is worse than no interview.",
  road: "Did they give these people something to say to their neighbours? Washington language in a state party room is worth less than nothing.",
};

const OPEN_SHAPE = `Respond with ONLY JSON:
{
  "scene": "2-4 sentences setting the room as it is right now",
  "voices": [
    { "who": "name and role, or name and outlet", "line": "what they say to the President, one or two sentences" }
  ],
  "asks": "the single sentence naming what the President has to answer",
  "options": [
    { "id": "<the advisor id you were given>", "plan": "what that advisor recommends, written as the President would say it out loud — 2-3 sentences, first person, concrete" }
  ]
}`;

/**
 * How good an advisor's recommendation is, in the recommendation.
 *
 * The whole point of appointing your own cabinet. A Defense Secretary you chose
 * for loyalty at competence 44 has to *propose worse plans* than the
 * professional you passed over — not have their plan quietly marked down
 * afterwards, which the player would never see. So the numbers are handed to
 * the model as a brief for writing the plan, and what they buy is visible in
 * the words: the good one has thought about the second week, the weak one has
 * a hole in it that the room can see, the disloyal one has put themselves
 * somewhere in it.
 *
 * They are written as the President would say them, because that is what the
 * player is choosing: not "I agree with Okafor" but the words that go on the
 * record.
 */
const OPTIONS_RULE = `THE THREE RECOMMENDATIONS:
You are given three advisors, each with a competence and a loyalty out of 100. Write one recommendation from each, in the "options" array, using the exact id you were given.

The numbers decide how good the plan actually is, and it must be visible in the plan itself rather than announced:
- COMPETENCE 75+: it works. Specific, sequenced, someone has thought about what happens in the second week, and the obvious objection is already answered inside it.
- COMPETENCE 50-74: serviceable and a little thin. It solves the immediate problem and leaves something for later.
- COMPETENCE BELOW 50: it sounds fine and has a hole in it a careful reader can find — the money is not there, the agency named cannot do that, the deadline is impossible, or it solves a different problem from the one in the room. Never say it is a bad plan. Write it as confidently as the others.
- LOYALTY BELOW 40: it is also, quietly, good for them — their department gets the money, their rival carries the blame, or their own position is the one that survives if it fails.
- LOYALTY 75+: it protects the President before it solves anything, which is sometimes the right instinct and sometimes exactly the wrong one.

Never label a plan as strong or weak, never mention competence or loyalty, and never make the weak one obviously stupid. The player is supposed to have to read them.`;

const JUDGE_SHAPE = `Respond with ONLY JSON:
{
  "reaction": "2-4 sentences on how the room took it, in the room's own voice",
  "voices": [
    { "who": "name and role", "line": "what one or two of them say back, one sentence each" }
  ],
  "judgement": number
}
"judgement" is an integer from -3 to +3 and it is the only number you return: -3 is a disaster that will follow them for months, 0 is a session that changed nothing either way, +3 is the rare one that people in that room will still be repeating years later. Most sessions are -1, 0 or +1. You are scoring THIS answer in THIS room and nothing else — not whether the policy is wise, not whether you agree with it.`;

function whoIsThis(state) {
  const s = state.scenario || {};
  if (state.office === "house" || state.office === "senate" || state.office === "statehouse") {
    const seat = state.seat || {};
    const where = state.office === "senate" ? seat.stateName : `${seat.district} (${seat.stateName})`;
    return `THE MEMBER: ${s.presidentName}, ${s.party}, ${s.ideology || "no stated ideology"}, `
      + `${state.office === "senate" ? "Senator" : "Representative"} for ${where}. `
      + `Term ${state.term || 1}, month ${state.month}. Standing at home ${Math.round(state.approval)}%, `
      + `with their caucus ${Math.round(state.leadership)}%.\n\n`
      + "THIS MEMBER'S GENDER IS NOT STATED ANYWHERE AND YOU MUST NOT GUESS IT. "
      + "Refer to them by surname, by title, or as they/them.";
  }
  return `THE PRESIDENT: ${s.presidentName}, ${s.party}, ${s.ideology || "no stated ideology"}. `
    + `Term ${state.term || 1}, month ${state.month}. Approval ${Math.round(state.approval)}%, `
    + `government stability ${Math.round(state.stability)}%.`;
}

/** The presidency and the chambers describe their countries differently. */
const summaryFor = (state) => {
  // A state legislator's country is their state, and nationSummary reads a
  // Congress and a President this career does not have.
  if (state.office === "statehouse") {
    return `THE STATE: ${state.seat?.stateName}. The chamber is ${state.chamber?.R || 0} Republican to `
      + `${state.chamber?.D || 0} Democrat. The governor is ${state.governor?.name} (${state.governor?.party}). `
      + `The budget is ${state.budget >= 0 ? `$${Math.round(state.budget)}m in hand` : `$${Math.abs(Math.round(state.budget))}m short`} `
      + "and has to balance before the session ends.";
  }
  return (state.office === "house" || state.office === "senate")
    ? nationSummary(state) : stateSummary(state);
};

/** The people in the room, for the rooms that have a fixed cast. */
function castFor(state, id) {
  const cabinet = state.cabinet || [];
  if (id === "cabinet") {
    return "THE TABLE:\n" + cabinet.slice(0, 6).map((m) =>
      `- ${m.role} ${m.name} — loyalty ${m.loyalty}/100, competence ${m.competence}/100`).join("\n");
  }
  if (id === "situation") {
    const security = cabinet.filter((m) => /state|defense|defence|security|intelligence|staff/i.test(m.role));
    return security.length
      ? "IN THE ROOM:\n" + security.slice(0, 4).map((m) => `- ${m.role} ${m.name}`).join("\n")
      : "";
  }
  return "";
}

/**
 * Open the room.
 *
 * `offer` is the line the board already showed the player, passed in so that
 * what they clicked on and what they walk into are the same thing. Nothing is
 * more deflating than a card promising a question about the investigation and a
 * room that opens on trade policy.
 */
export async function openRoom(state, id, { offer = "", event = null } = {}) {
  const room = roomById(id);
  if (!room) throw new Error(`No such room: ${id}`);
  const advisors = advisorsFor(state, id, event);

  const user = `${summaryFor(state)}

${whoIsThis(state)}
${castFor(state, id)}

${event?.title ? `THIS MONTH'S SITUATION: ${event.title} — ${event.brief || ""}\n` : ""}
WHAT THE BOARD PROMISED THIS ROOM WOULD BE ABOUT: ${offer || "the ordinary business of the office"}

THE THREE ADVISORS RECOMMENDING SOMETHING, WITH THE ID TO USE FOR EACH:
${advisors.map((a) => `- id="${a.id}" — ${a.role} ${a.name}, competence ${a.competence}/100, loyalty ${a.loyalty}/100`).join("\n")}

Open the room. Return the JSON object.`;

  const resp = await complete({
    system: `${houseRules(state)}\n\n${ROOM_BRIEF[id]}\n\n${OPTIONS_RULE}\n\n${OPEN_SHAPE}`,
    messages: [{ role: "user", content: user }],
    tier: "chat",
    maxTokens: 1600,
    json: true,
  });

  return validateOpening(parseModelJson(resp.text), advisors);
}

/**
 * The recommendations, matched back to the people who made them.
 *
 * By id, and only by id — a plan attributed to somebody who is not in the room
 * is dropped rather than reassigned, because the whole value of the option is
 * knowing whose judgement you are buying. An opening with no usable options is
 * a room with a blank box in it, which is exactly what it was yesterday.
 */
function validOptions(raw, advisors) {
  const byId = new Map(advisors.map((a) => [a.id, a]));
  const out = [];
  const used = new Set();

  for (const item of (Array.isArray(raw) ? raw : [])) {
    const who = byId.get(String(item?.id || "").trim());
    const plan = String(item?.plan || "").trim();
    if (!who || used.has(who.id) || plan.length < 20) continue;
    used.add(who.id);
    out.push({
      id: who.id,
      who: `${who.role} ${who.name}`,
      emoji: who.emoji,
      plan: plan.slice(0, 700),
    });
  }
  return out;
}

export function validateOpening(raw, advisors = []) {
  return {
    options: validOptions(raw?.options, advisors),
    scene: String(raw?.scene || "").trim().slice(0, 700),
    voices: (Array.isArray(raw?.voices) ? raw.voices : []).slice(0, 4)
      .filter((v) => v?.line)
      .map((v) => ({
        /**
         * The first live briefing came back with "Lena Martinez from Reuters"
         * and "James Taylor from CNN" — invented people standing next to real
         * news organisations, in a prompt that says to invent every one of
         * them. The person keeps their question; the employer goes.
         */
        who: withoutRealOutlet(v.who) || "A voice in the room",
        line: String(v.line).slice(0, 320),
      })),
    asks: String(raw?.asks || "").trim().slice(0, 240),
  };
}

/** What the room made of the answer. */
export async function judgeRoom(state, id, opening, answer, { event = null } = {}) {
  const room = roomById(id);
  if (!room) throw new Error(`No such room: ${id}`);

  const user = `${whoIsThis(state)}

${event?.title ? `THIS MONTH'S SITUATION: ${event.title}\n` : ""}
HOW THE ROOM OPENED:
${opening.scene}
${opening.voices.map((v) => `- ${v.who}: "${v.line}"`).join("\n")}
${opening.asks ? `They want to know: ${opening.asks}` : ""}

WHAT THE PRESIDENT SAID, IN FULL:
"""${String(answer).slice(0, 1600)}"""

HOW TO SCORE IT: ${JUDGE_BRIEF[id]}

Return the JSON object.`;

  const resp = await complete({
    system: `${houseRules(state)}\n\n${ROOM_BRIEF[id]}\n\n${JUDGE_SHAPE}`,
    messages: [{ role: "user", content: user }],
    tier: "judge",
    maxTokens: 1200,
    json: true,
  });

  const verdict = validateJudgement(parseModelJson(resp.text));
  if (verdict.judgement > 0 && !answersTheRoom(opening, answer)) {
    console.warn(`[room] the ${id} judged an answer at +${verdict.judgement} that shares no `
      + "subject with what it asked. Capping it: a confident answer to a different question is "
      + "not a good answer.");
    return { ...verdict, judgement: 0, offTopic: true };
  }
  return verdict;
}

const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "been", "before", "being", "between", "both",
  "cannot", "could", "does", "doing", "down", "each", "from", "further", "have", "having", "here",
  "into", "itself", "more", "most", "only", "other", "over", "same", "should", "some", "such",
  "than", "that", "their", "them", "then", "there", "these", "they", "this", "those", "through",
  "under", "until", "very", "were", "what", "when", "where", "which", "while", "will", "with",
  "would", "your", "yours", "president", "administration", "government", "federal", "america",
  "american", "united", "states", "country", "nation", "national", "people", "public",
]);

const contentWords = (text) => new Set(
  String(text || "").toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g)?.filter((w) => !STOPWORDS.has(w)) || [],
);

/**
 * Whether the answer is about the thing the room asked about.
 *
 * A live session: the room was a cyber attack on the power and water utilities,
 * and the answer released forty million barrels from the strategic reserve and
 * put the Coast Guard on containment. It scored +2. The model rewards a crisp,
 * specific, well-staffed decision and does not reliably check what the decision
 * is *about* — telling it to, in the prompt, did not fix it either.
 *
 * So the engine checks, the way it checks everything else the model volunteers.
 * Deliberately the crudest possible test: does the answer share a single
 * content word with what was asked? A real answer to a cyber attack says
 * "cyber", or "utilities", or "grid". An answer about refineries says none of
 * them. Anything that clears that bar is the model's call again, because
 * judging whether an answer is *good* is exactly what a model is for and
 * counting whether it is on the subject is exactly what it is not.
 */
export function answersTheRoom(opening, answer) {
  const asked = contentWords(`${opening?.asks || ""} ${opening?.scene || ""}`);
  const said = contentWords(answer);
  if (!asked.size || said.size < 8) return true;         // nothing to check against
  for (const word of said) if (asked.has(word)) return true;
  return false;
}

export function validateJudgement(raw) {
  const n = Number(raw?.judgement);
  return {
    reaction: String(raw?.reaction || "").trim().slice(0, 700),
    voices: (Array.isArray(raw?.voices) ? raw.voices : []).slice(0, 3)
      .filter((v) => v?.line)
      .map((v) => ({
        /**
         * The first live briefing came back with "Lena Martinez from Reuters"
         * and "James Taylor from CNN" — invented people standing next to real
         * news organisations, in a prompt that says to invent every one of
         * them. The person keeps their question; the employer goes.
         */
        who: withoutRealOutlet(v.who) || "A voice in the room",
        line: String(v.line).slice(0, 320),
      })),
    /**
     * A judgement the model did not send is not a zero, it is a missing
     * judgement — but the session still has to resolve, and resolving it at
     * neutral is the only honest thing to do with an answer nobody scored.
     */
    judgement: Number.isFinite(n) ? Math.max(-3, Math.min(3, Math.round(n))) : 0,
  };
}

// ---------------------------------------------------------------------------
// The written version of every room
// ---------------------------------------------------------------------------

/**
 * No model, or a model that failed, and the room still has to happen.
 *
 * Deliberately not a stub. A president with no API key gets a room with a name
 * on the door, somebody in it saying something specific to the month, and a
 * score for what they wrote — which is the whole session, minus the part where
 * it is different every time.
 */
const WRITTEN = {
  situation: {
    scene: "The room is full and nobody is sitting down. Every option on the table was rejected once "
      + "already this week and they are all back, because nothing better has been thought of since.",
    voices: [
      { who: "The Chief of Staff", line: "Whatever you decide, decide it in here. The agencies are already improvising." },
    ],
    asks: "What are we doing, and who is responsible for it?",
  },
  press: {
    scene: "Forty seats, thirty-one of them filled, and two people at the back with a camera each.",
    voices: [
      { who: "The wire reporter", line: "Can you say plainly whether the administration knew before the reporting or after it?" },
      { who: "The network correspondent", line: "Is anybody going to lose their job over this, or is that not how this works?" },
    ],
    asks: "Answer the question that was asked.",
  },
  cabinet: {
    scene: "Two departments want the same money and have both written memoranda explaining why the "
      + "other one is being irresponsible. Both memoranda have already leaked.",
    voices: [
      { who: "A secretary", line: "We can do it properly or we can do it by the date you announced. Not both." },
    ],
    asks: "Which of them are you backing, and what do you tell the other one?",
  },
  hill: {
    scene: "Leadership arrives fifteen minutes late with a whip count and no interest in the merits.",
    voices: [
      { who: "The Majority Leader", line: "I have the votes for a version of this. You will not like the version." },
    ],
    asks: "What are you willing to pay, and what are you not?",
  },
  brief: {
    scene: "The book is thinner than usual, which the briefer mentions twice.",
    voices: [
      { who: "The DNI", line: "Item two is routine. Item three has been routine for four weeks, which is what concerns me." },
    ],
    asks: "What do you want followed up?",
  },
  road: {
    scene: "A hall that holds four hundred and has three hundred in it, which the local party is at "
      + "pains to explain was the fire marshal's decision.",
    voices: [
      { who: "A county chair", line: "We knocked every door in this county for you. What do I tell them you did with it?" },
    ],
    asks: "Give them something they can repeat.",
  },
  district: {
    scene: "Four caseworkers, a waiting room with six people in it, and a filing cabinet nobody has "
      + "opened since the last member.",
    voices: [
      { who: "Your caseworker", line: "The Delgado family have been waiting eleven weeks on a passport for a funeral that is on Saturday." },
    ],
    asks: "Which of these are you personally picking up the phone about?",
  },
  committee: {
    scene: "The witness has been prepared to within an inch of their life and the chair is running "
      + "eighteen minutes behind. You have five minutes.",
    voices: [
      { who: "Committee counsel", line: "They will answer the question you ask. Ask the one they have not been given an answer for." },
    ],
    asks: "What are you asking them?",
  },
  caucus: {
    scene: "Two hundred people in a room built for a hundred and forty, and leadership wants the "
      + "week's votes locked before lunch.",
    voices: [
      { who: "The whip", line: "I have you down as a maybe, which is a word I do not have room for this week." },
    ],
    asks: "What are you telling them?",
  },
  cloakroom: {
    scene: "Two colleagues, a bad sofa, and the sort of conversation that never appears in a diary.",
    voices: [
      { who: "A colleague", line: "I will sign yours if mine gets a hearing. That is the whole offer and it expires Thursday." },
    ],
    asks: "What are you trading, and what for?",
  },
  localpress: {
    scene: "A studio the size of a cupboard and a host who has been doing the drive-time show since "
      + "before you were elected.",
    voices: [
      { who: "The host", line: "Explain that vote to somebody in this county who works shifts. In their words, not yours." },
    ],
    asks: "Say it the way they would say it.",
  },
};

/**
 * Three recommendations without a model, which still have to differ by who is
 * making them.
 *
 * A competence band each, chosen by the advisor's own number rather than by
 * position in the list, so the offline game teaches the same lesson the online
 * one does: the plan you are offered is only as good as the person you
 * appointed. They are shorter and blunter than the written ones, because a
 * template that tried to sound like the model would sound like neither.
 */
/**
 * Written to fit either building.
 *
 * The first set was phrased for the West Wing — "move the money first, an
 * inspector general watching every one of them" — and two of them turned up in
 * a congressional district office being offered to a backbencher about a
 * passport backlog. These say the same things about competence and loyalty
 * without assuming the speaker commands an agency.
 */
const WRITTEN_PLANS = {
  strong: [
    "Name one person to own it, give them a date, and put it in writing today. I will take the "
      + "questions myself when it slips, because some of it will.",
    "Deal with the three that are closest to a deadline before anything else, and I want the "
      + "list on my desk on Friday with names on it rather than numbers.",
    "Do the part we can actually finish this month and say plainly that it is a part. Half a "
      + "promise kept is worth more here than a whole one announced.",
  ],
  thin: [
    "Get something moving this week and keep the options open until we know more than we do "
      + "this morning.",
    "Work through it in order, flag anything that looks like it will embarrass us, and come "
      + "back to the rest when we have the numbers.",
    "Say we are looking at it, mean it, and make sure somebody is actually looking at it.",
  ],
  weak: [
    "Announce the whole thing this week. The money can be found internally and we can have it "
      + "running by the end of the month.",
    "Put it all under one heading, hand it to somebody capable, and let them come back to us "
      + "once they have had a proper look at it.",
    "Get out in front of it publicly. If we are seen to act quickly the detail matters much "
      + "less than people think.",
  ],
  selfServing: [
    "Let my side of the office carry this. If it goes wrong it should be us explaining it, and "
      + "if it goes right it should be you announcing it.",
    "Give it to us with the resources attached and I will take it on publicly. It keeps your "
      + "name off the difficult half.",
    "I would keep you out of this one entirely until it is settled. There is no version where "
      + "being early on it helps you.",
  ],
};

const bandFor = (advisor) => (advisor.loyalty < 40 ? "selfServing"
  : advisor.competence >= 75 ? "strong"
  : advisor.competence >= 50 ? "thin" : "weak");

/**
 * Three recommendations, however many the model managed.
 *
 * It returned one, live: a 14b holding a scene, two questions, an ask and three
 * plans in a single JSON object drops the tail of the list under load. Backing
 * off to the written scene to recover them would throw away a good room, and
 * leaving it short means one advisor speaks and the other two are silently
 * absent — the player has no way to tell that from a cabinet with nothing to
 * say. So the gaps are filled from the written plans, by the advisor who was
 * supposed to fill them.
 */
export function toppedUp(options, state, id, event = null) {
  const have = new Map((options || []).map((o) => [o.id, o]));
  return writtenOptions(state, id, event).map((fallback) => have.get(fallback.id) || fallback);
}

export function writtenOptions(state, id, event = null) {
  const advisors = advisorsFor(state, id, event);
  const used = new Set();

  return advisors.map((advisor) => {
    /**
     * Seeded per advisor, and never the same line twice in one room.
     *
     * One seed for the whole room put the identical sentence in two people's
     * mouths in a live session — two advisors in the same competence band drew
     * the same plan, and a room where two of the three recommendations are word
     * for word identical reads as broken rather than as agreement.
     */
    const r = seeded(`${state.scenario?.presidentName || "potus"}|plans|${id}|${advisor.id}`
      + `|${state.term || 1}|${state.month}`);
    const pool = WRITTEN_PLANS[bandFor(advisor)];
    const fresh = pool.filter((p) => !used.has(p));
    const plan = r.pick(fresh.length ? fresh : pool);
    used.add(plan);

    return {
      id: advisor.id,
      who: `${advisor.role} ${advisor.name}`,
      emoji: advisor.emoji,
      plan,
    };
  });
}

export const writtenOpening = (id, state = null, event = null) => ({
  ...(WRITTEN[id] || WRITTEN.situation),
  options: state ? writtenOptions(state, id, event) : [],
});

/**
 * And a score for it, without a model.
 *
 * Length is a poor proxy for quality and an excellent proxy for effort, which
 * is the thing the offline engine has always rewarded — see `mockTurn`. A
 * seeded wobble keeps two identical answers in two different months from
 * scoring identically, because a room is a room and not a marking scheme.
 */
export function writtenJudgement(state, id, answer) {
  const words = String(answer || "").trim().split(/\s+/).filter(Boolean).length;
  const r = seeded(`${state.scenario?.presidentName || "potus"}|room|${id}|${state.term || 1}|${state.month}`);
  const base = words >= 60 ? 2 : words >= 25 ? 1 : words >= 8 ? 0 : -2;
  const judgement = Math.max(-3, Math.min(3, base + (r.chance(0.3) ? 1 : 0) - (r.chance(0.3) ? 1 : 0)));

  return {
    reaction: judgement > 0
      ? "It landed. Nobody in the room got what they wanted and everybody got an answer, which is "
        + "the most a room like this ever produces."
      : judgement < 0
        ? "It did not land. They came in wanting a decision and left with a position, and the "
          + "difference between those is what this room exists to notice."
        : "They took it, wrote it down, and moved to the next item.",
    voices: [],
    judgement,
  };
}
