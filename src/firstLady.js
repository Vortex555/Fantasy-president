import { mulberry32, hashString, clamp, round1 } from "./rng.js";

/**
 * The East Wing.
 *
 * The president's spouse is the only figure in the administration with their
 * own public standing — often higher than the president's — and it is spent,
 * not banked. Sending them somewhere moves a bloc, but a spouse deployed as a
 * political weapon loses the thing that made them useful.
 */

const TRAITS = [
  { id: "campaigner", line: "Campaigns hard for the causes she believes in.", standing: 8, drain: 1.4 },
  { id: "guardian", line: "Guards the family fiercely and the podium reluctantly.", standing: 4, drain: 0.7 },
  { id: "operator", line: "A political operator in her own right, and everyone knows it.", standing: 0, drain: 1 },
  { id: "private", line: "Would rather the country forgot the East Wing existed.", standing: 10, drain: 2 },
  { id: "celebrity", line: "Was famous before the marriage and still polls better than the ticket.", standing: 14, drain: 1.1 },
];

const CAUSES = [
  { id: "veterans", label: "veterans' mental health reform", blocs: { pentagon: 5, civil_rights: 1 } },
  { id: "literacy", label: "childhood literacy", blocs: { civil_rights: 3, labor: 2 } },
  { id: "opioids", label: "opioid recovery and rural clinics", blocs: { faith: 4, labor: 3 } },
  { id: "maternal", label: "maternal and infant health", blocs: { civil_rights: 5, faith: 2 } },
  { id: "hunger", label: "school meals and child hunger", blocs: { labor: 5, civil_rights: 3 } },
  { id: "online", label: "keeping children safe online", blocs: { faith: 5, big_business: -3 } },
  { id: "conservation", label: "land conservation and the national parks", blocs: { greens: 6, gun_owners: 2 } },
  { id: "smallbiz", label: "main-street small business", blocs: { big_business: 4, labor: 2 } },
];

const FIRST_NAMES = {
  female: ["Eleanor", "Margaret", "Rosalind", "Ingrid", "Camille", "Aurora", "Vivian", "Delia", "Marisol", "Noor"],
  male: ["Theodore", "Julian", "Everett", "Malik", "Anders", "Rafael", "Desmond", "Ilya", "Caleb", "Emeka"],
};

const PRIOR_LIVES = [
  "a former emergency-room physician and Army reservist",
  "a civil-rights attorney who never stopped taking pro-bono cases",
  "a documentary film-maker with a following of their own",
  "a high-school principal from the district that started it all",
  "a cardiac surgeon who still scrubs in one weekend a month",
  "a novelist whose last book outsold the campaign memoir",
  "a career diplomat who quit the service the week of the nomination",
];

/** "First Lady" or "First Gentleman", from the president's own gender. */
export function spouseTitle(scenario) {
  return scenario?.gender === "female" ? "First Gentleman" : "First Lady";
}

const spouseGender = (scenario) => (scenario?.gender === "female" ? "male" : "female");

export function buildFirstLady(scenario) {
  const rng = mulberry32(hashString(`${scenario.presidentName}|spouse`));
  const pick = (list) => list[Math.floor(rng() * list.length)];

  const gender = spouseGender(scenario);
  const trait = pick(TRAITS);
  const cause = pick(CAUSES);
  const surname = String(scenario.presidentName).trim().split(/\s+/).slice(-1)[0] || "Hale";
  const name = `Dr. ${pick(FIRST_NAMES[gender])} ${surname}`;
  const prior = pick(PRIOR_LIVES);

  return {
    name,
    gender,
    title: spouseTitle(scenario),
    traitId: trait.id,
    trait: trait.line,
    causeId: cause.id,
    cause: cause.label,
    // Standing is deliberately generous: spouses start more trusted than the
    // president, which is exactly what makes spending it a real decision.
    standing: clamp(Math.round(58 + trait.standing + rng() * 12)),
    bio: `Once ${prior}, ${name.split(" ")[1]} turned a private conviction into a national campaign for ${cause.label}.`,
    deployments: [],
  };
}

/** What kind of trip this is, from what the president typed. */
function classifyDeployment(text) {
  const t = String(text).toLowerCase();
  if (/\b(rally|campaign|swing|district|voters?|stump|fundrais|donor)\b/.test(t)) return "campaign";
  if (/\b(disaster|flood|fire|hurricane|shooting|funeral|memorial|victims?|grief|mourn)\b/.test(t)) return "consolation";
  if (/\b(hospital|clinic|school|shelter|veteran|children|literacy|recovery|charity|volunteer)\b/.test(t)) return "cause";
  if (/\b(summit|visit|abroad|foreign|embassy|delegation|state dinner|olympic)\b/.test(t)) return "diplomacy";
  if (/\b(attack|defend|hit back|slam|blast|opponent|critics?|smear)\b/.test(t)) return "attack";
  return "cause";
}

const PLAYBOOK = {
  campaign: {
    approval: 1.6, standing: -6,
    note: "drew bigger crowds than the President has managed all year — and spent some of her own goodwill doing it",
    blocs: { labor: 2 },
  },
  consolation: {
    approval: 2.2, standing: 2,
    note: "sat with the families for three hours after the cameras left, and it was the cameras leaving that made the coverage",
    blocs: { faith: 4, civil_rights: 2 },
  },
  cause: {
    approval: 0.8, standing: 4,
    note: "put the issue on the evening news without putting the President on it",
    blocs: {},
  },
  diplomacy: {
    approval: 1.1, standing: 1,
    note: "was received warmly enough that two governments asked for a follow-up the West Wing had not managed to arrange",
    blocs: { pentagon: 2 },
  },
  attack: {
    approval: -0.6, standing: -11,
    note: "went on the offensive, and the coverage was about the East Wing attacking rather than about the argument",
    blocs: { big_business: -2 },
  },
};

/**
 * Send the spouse somewhere. Deterministic: the numbers never depend on a
 * model, so a deployment is always worth exactly what the rules say.
 */
export function deployEastWing(state, instruction) {
  const lady = state.firstLady;
  if (!lady) return { rejected: true, note: "There is no East Wing in this administration." };

  const text = String(instruction || "").trim();
  if (text.length < 3) return { rejected: true, note: "Say where you are sending them." };

  const kind = classifyDeployment(text);
  const play = PLAYBOOK[kind];
  const trait = TRAITS.find((t) => t.id === lady.traitId) || TRAITS[2];
  const cause = CAUSES.find((c) => c.id === lady.causeId);

  // Standing is the multiplier: a trusted spouse simply lands harder.
  const weight = clamp(lady.standing, 20, 100) / 65;
  const onMessage = kind === "cause" && cause &&
    new RegExp(cause.label.split(" ")[0], "i").test(text);

  const approvalChange = round1(play.approval * weight + (onMessage ? 0.9 : 0));
  const standingChange = Math.round(
    play.standing >= 0 ? play.standing : play.standing * trait.drain);

  const blocs = { ...play.blocs };
  if (onMessage && cause) {
    for (const [id, v] of Object.entries(cause.blocs)) blocs[id] = (blocs[id] || 0) + v;
  }

  const note = `${lady.name} ${play.note}.` +
    (onMessage ? ` Staying on ${cause.label} is what made it land.` : "");

  return {
    kind, approvalChange, standingChange, blocs, note,
    onMessage: Boolean(onMessage),
  };
}

/** Fold a deployment into a new state. */
export function applyDeployment(state, instruction) {
  const outcome = deployEastWing(state, instruction);
  if (outcome.rejected) return { state, outcome };

  const next = structuredClone(state);
  next.firstLady.standing = clamp(next.firstLady.standing + outcome.standingChange);
  next.approval = clamp(round1(next.approval + outcome.approvalChange));
  for (const [id, delta] of Object.entries(outcome.blocs)) {
    if (next.stakeholders[id] != null) {
      next.stakeholders[id] = clamp(Math.round(next.stakeholders[id] + delta));
    }
  }
  next.firstLady.deployments = [
    ...(next.firstLady.deployments || []),
    { month: state.month, instruction: String(instruction).slice(0, 200), kind: outcome.kind },
  ].slice(-12);

  return { state: next, outcome };
}

/** Rename the spouse or change their signature cause. */
export function editFirstLady(state, patch) {
  const next = structuredClone(state);
  const name = String(patch?.name || "").trim().slice(0, 60);
  if (name) next.firstLady.name = name;

  const cause = CAUSES.find((c) => c.id === patch?.causeId);
  if (cause) {
    next.firstLady.causeId = cause.id;
    next.firstLady.cause = cause.label;
    // A newly adopted cause has not been built up yet.
    next.firstLady.standing = clamp(next.firstLady.standing - 4);
  }
  return next;
}

/** Standing drifts back toward the president's own number over a term. */
export function tickFirstLady(next) {
  if (!next.firstLady) return;
  const pull = (next.approval - next.firstLady.standing) * 0.04;
  next.firstLady.standing = clamp(Math.round(next.firstLady.standing + pull + 0.5));
}

export { CAUSES as FIRST_LADY_CAUSES };
