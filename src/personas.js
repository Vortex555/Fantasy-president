// ---------------------------------------------------------------------------
// The focus group — 30 recurring American voters.
//
// The roster is code, not AI output: it ships once inside the cached system
// prefix, so the model never re-emits names and demographics. Every voter's
// mood is computed deterministically each month (free), and only a rotating
// cast is asked for a written quote — which is what keeps a 30-person panel
// cheaper than the 5 fully-generated personas it replaces.
// ---------------------------------------------------------------------------

// lean: -1 (left) .. +1 (right). issues: stakeholder ids they actually feel.
// sex: only ever read by the franchise mechanics in specialActions.js, which
// can remove a whole bloc from the electorate.
export const PERSONAS = [
  { id: "p01", name: "Dolores M.", group: "Retired teacher, Ohio",          state: "OH", lean: -0.4, issues: ["labor", "faith"] , sex: "f" },
  { id: "p02", name: "Marcus T.",  group: "Rideshare driver, Georgia",      state: "GA", lean: -0.3, issues: ["labor", "civil_rights"] , sex: "m" },
  { id: "p03", name: "Priya K.",   group: "Software engineer, Washington",  state: "WA", lean: -0.6, issues: ["big_business", "greens"] , sex: "f" },
  { id: "p04", name: "Wade H.",    group: "Cattle rancher, Texas",          state: "TX", lean:  0.8, issues: ["gun_owners", "greens"] , sex: "m" },
  { id: "p05", name: "Angela R.",  group: "ER nurse, Pennsylvania",         state: "PA", lean: -0.2, issues: ["labor", "faith"] , sex: "f" },
  { id: "p06", name: "Diego S.",   group: "Small-business owner, Arizona",  state: "AZ", lean:  0.3, issues: ["big_business", "labor"] , sex: "m" },
  { id: "p07", name: "Ruth B.",    group: "Retired machinist, Michigan",    state: "MI", lean: -0.5, issues: ["labor", "big_business"] , sex: "f" },
  { id: "p08", name: "Cole R.",    group: "Oil rig hand, North Dakota",     state: "ND", lean:  0.7, issues: ["greens", "labor"] , sex: "m" },
  { id: "p09", name: "Yolanda P.", group: "Pastor, Alabama",                state: "AL", lean:  0.5, issues: ["faith", "civil_rights"] , sex: "f" },
  { id: "p10", name: "Ethan W.",   group: "Grad student, Massachusetts",    state: "MA", lean: -0.9, issues: ["greens", "civil_rights"] , sex: "m" },
  { id: "p11", name: "Grace L.",   group: "Hospital admin, Minnesota",      state: "MN", lean: -0.3, issues: ["labor", "big_business"] , sex: "f" },
  { id: "p12", name: "Hank D.",    group: "Long-haul trucker, Missouri",    state: "MO", lean:  0.6, issues: ["labor", "greens"] , sex: "m" },
  { id: "p13", name: "Aisha N.",   group: "Public defender, Illinois",      state: "IL", lean: -0.8, issues: ["civil_rights", "faith"] , sex: "f" },
  { id: "p14", name: "Frank O.",   group: "Retired Marine, Virginia",       state: "VA", lean:  0.6, issues: ["pentagon", "gun_owners"] , sex: "m" },
  { id: "p15", name: "Bea C.",     group: "Dairy farmer, Wisconsin",        state: "WI", lean:  0.2, issues: ["greens", "big_business"] , sex: "f" },
  { id: "p16", name: "Terrell J.", group: "Union electrician, Nevada",      state: "NV", lean: -0.5, issues: ["labor", "wall_street"] , sex: "m" },
  { id: "p17", name: "Nora F.",    group: "Fishing captain, Maine",         state: "ME", lean:  0.1, issues: ["greens", "labor"] , sex: "f" },
  { id: "p18", name: "Victor A.",  group: "Bodega owner, New York",         state: "NY", lean: -0.4, issues: ["big_business", "civil_rights"] , sex: "m" },
  { id: "p19", name: "Sandra Q.",  group: "School principal, Colorado",     state: "CO", lean: -0.3, issues: ["gun_owners", "labor"] , sex: "f" },
  { id: "p20", name: "Buck E.",    group: "Gun shop owner, Idaho",          state: "ID", lean:  0.9, issues: ["gun_owners", "faith"] , sex: "m" },
  { id: "p21", name: "Leila H.",   group: "Pharmacist, New Jersey",         state: "NJ", lean: -0.2, issues: ["big_business", "faith"] , sex: "f" },
  { id: "p22", name: "Owen G.",    group: "Coal miner, West Virginia",      state: "WV", lean:  0.7, issues: ["greens", "labor"] , sex: "m" },
  { id: "p23", name: "Mei Z.",     group: "Biotech researcher, California", state: "CA", lean: -0.7, issues: ["greens", "big_business"] , sex: "f" },
  { id: "p24", name: "Roy K.",     group: "Hotel manager, Florida",         state: "FL", lean:  0.4, issues: ["big_business", "labor"] , sex: "m" },
  { id: "p25", name: "Tanya B.",   group: "Social worker, New Mexico",      state: "NM", lean: -0.6, issues: ["civil_rights", "faith"] , sex: "f" },
  { id: "p26", name: "Glenn S.",   group: "Retired banker, Connecticut",    state: "CT", lean:  0.4, issues: ["wall_street", "big_business"] , sex: "m" },
  { id: "p27", name: "Imani W.",   group: "Bus driver, Maryland",           state: "MD", lean: -0.7, issues: ["labor", "civil_rights"] , sex: "f" },
  { id: "p28", name: "Dale P.",    group: "Corn farmer, Iowa",              state: "IA", lean:  0.3, issues: ["greens", "big_business"] , sex: "m" },
  { id: "p29", name: "Sofia V.",   group: "Line cook, Oregon",              state: "OR", lean: -0.5, issues: ["labor", "greens"] , sex: "f" },
  { id: "p30", name: "Judd M.",    group: "Sheriff's deputy, Tennessee",    state: "TN", lean:  0.7, issues: ["gun_owners", "civil_rights"] , sex: "m" },
];

export const PERSONA_BY_ID = new Map(PERSONAS.map((p) => [p.id, p]));

// How many of the 30 are asked for a written quote each month. The rest still
// register a mood — they just don't speak this turn.
export const SPEAKERS_PER_TURN = 8;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** How far from neutral a voter has to be before they commit either way. */
export const MOOD_THRESHOLD = 1.8;

/**
 * How far apart two politics are, 0 (identical) to 1 (opposite ends).
 * Both `lean` and an ideology's `axis` live on the same −1…+1 spectrum.
 */
const distance = (lean, axis) => Math.abs(lean - axis) / 2;

/**
 * Rank the panel by how close each voter is to the president's politics.
 *
 * This is the coalition that elected them. Roughly half the country voted for
 * this person and what they campaigned on, so roughly half the panel has to
 * start on their side — and the ranking is what makes that true no matter
 * where on the spectrum the president actually sits.
 *
 * Returns a Map of persona id → rank in 0…1, where 1 is the most aligned.
 */
export function coalitionRanks(presidentAxis, personas = PERSONAS) {
  const ordered = [...personas].sort(
    (a, b) => distance(b.lean, presidentAxis) - distance(a.lean, presidentAxis));
  const last = Math.max(1, ordered.length - 1);
  return new Map(ordered.map((p, i) => [p.id, i / last]));
}

/**
 * Score how a single voter feels about this month.
 *
 * `rank` is where they sit in the president's coalition and sets the floor:
 * the people who elected this president start supportive and the people who
 * did not start hostile. `approval` then lifts or sinks the whole panel, and
 * only after that does the month's own news move anyone.
 *
 * `intensity` is how polarising the president's politics are. A radical widens
 * the gap at both ends — more love, more loathing, fewer shrugs.
 */
export function scorePersona(persona, {
  approvalChange = 0, stakeholders = {}, states = {},
  approval = 50, rank = 0.5, intensity = 1,
}) {
  // The president has the support of `approval`% of the country, so the people
  // above that line in the coalition are the ones with them. Sitting the pivot
  // exactly on the approve threshold makes the panel's split match the national
  // number: win 55% of the country and 55% of the panel is behind you.
  const pivot = 1 - approval / 100;
  const coalition = (rank - pivot) * 12 * intensity + MOOD_THRESHOLD;

  // `approval` has already absorbed this month's swing, so the change is only
  // a small read on direction — people feel a presidency rising or sinking on
  // top of where it already stands. Weighting it heavily double-counts it.
  let score = coalition + approvalChange * 0.15;

  for (const issue of persona.issues) {
    score += (stakeholders[issue] || 0) * 0.22;
  }
  score += (states[persona.state] || 0) * 0.3;

  return Math.round(score * 10) / 10;
}

export function moodFromScore(score) {
  if (score > MOOD_THRESHOLD) return "approve";
  if (score < -MOOD_THRESHOLD) return "disapprove";
  return "mixed";
}

/**
 * Every voter's reaction for the month. Pure, deterministic, and free — no
 * model call is involved in producing a mood.
 */
/**
 * The panel, minus anyone the president has removed from the electorate. A
 * disenfranchised voter does not stop existing — they stop being polled, which
 * is exactly the point of the mechanic that removed them.
 */
export function eligiblePersonas(electorate) {
  const excluded = electorate?.excluded;
  if (!excluded) return PERSONAS;
  return PERSONAS.filter((p) => p.sex !== excluded);
}

export function scoreAll(context) {
  const panel = eligiblePersonas(context.electorate);
  // Ranked within the electorate that actually exists, so disenfranchising a
  // bloc re-forms the coalition around whoever is left.
  const ranks = coalitionRanks(context.presidentAxis ?? 0, panel);

  return panel.map((p) => {
    const score = scorePersona(p, { ...context, rank: ranks.get(p.id) });
    return { id: p.id, name: p.name, group: p.group, score, mood: moodFromScore(score) };
  });
}

/**
 * Pick who actually speaks. Strong reactions are more interesting to read, so
 * candidates are drawn from the most-moved voters — but the window rotates by
 * month so the same loud voices don't monopolise every turn.
 */
export function selectSpeakers(scored, month, count = SPEAKERS_PER_TURN) {
  const n = clamp(count, 1, scored.length);
  const ranked = [...scored].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const pool = ranked.slice(0, Math.min(scored.length, n * 2));
  const offset = ((month - 1) * n) % pool.length;
  const picked = [];
  for (let i = 0; i < n; i++) picked.push(pool[(offset + i) % pool.length]);
  return picked;
}

/** The roster block that ships inside the cached system prefix. */
export function rosterPrompt() {
  return PERSONAS.map((p) => `${p.id} | ${p.name} | ${p.group} | leans ${p.lean > 0.2 ? "right" : p.lean < -0.2 ? "left" : "centrist"}`).join("\n");
}

/** Merge model-written quotes back onto the engine's moods. */
export function attachQuotes(scored, quotes) {
  const byId = new Map((quotes || []).filter((q) => q && q.id).map((q) => [String(q.id), q]));
  return scored.map((s) => {
    const q = byId.get(s.id);
    return q?.quote ? { ...s, quote: String(q.quote).slice(0, 320) } : s;
  });
}
