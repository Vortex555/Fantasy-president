"use strict";

/**
 * The character profile catalogs.
 *
 * Every option carries an `fx` block that is applied when the game is seeded,
 * so nothing here is decorative:
 *   stakeholder ids (wall_street, big_business, pentagon, labor, greens,
 *   civil_rights, gun_owners, faith)  → starting support for that bloc
 *   approval                          → starting national approval
 *   stability                         → starting government stability
 *   region                            → a home-state bonus, applied by code
 *
 * Identity options (race, religion) shape how the president is written and
 * which coalition they start closest to. They never carry a penalty for who
 * the president is — only affinities.
 */

export const AGES = [
  { value: "40s", label: "40s", sub: "Energy, inexperience", fx: { approval: 1, stability: -2 } },
  { value: "50s", label: "50s", sub: "Balanced", fx: {} },
  { value: "60s-70s", label: "60s–70s", sub: "Authority, scrutiny", fx: { approval: -1, stability: 2 } },
  { value: "custom", label: "✏️ Custom", sub: "Type any age", fx: {}, custom: true },
];

export const RACES = [
  { value: "White", fx: {} },
  { value: "Black", fx: { civil_rights: 8 } },
  { value: "Hispanic", fx: { civil_rights: 6 } },
  { value: "Asian American", fx: { civil_rights: 5 } },
  { value: "East Asian American", fx: { civil_rights: 5 } },
  { value: "South Asian American", fx: { civil_rights: 5 } },
  { value: "Middle Eastern / North African", fx: { civil_rights: 5 } },
  { value: "Iranian American", fx: { civil_rights: 5 } },
  { value: "Native American / Indigenous", fx: { civil_rights: 7, greens: 4 } },
  { value: "Mixed Race", fx: { civil_rights: 5 } },
];

export const RELIGIONS = [
  { value: "Protestant", fx: { faith: 5 } },
  { value: "Catholic", fx: { faith: 5 } },
  { value: "Evangelical", fx: { faith: 12, greens: -3 } },
  { value: "Mormon (LDS)", fx: { faith: 8 } },
  { value: "Jewish", fx: { faith: 3 } },
  { value: "Muslim", fx: { faith: 3, civil_rights: 4 } },
  { value: "Hindu", fx: { faith: 3, civil_rights: 3 } },
  { value: "Buddhist", fx: { faith: 2, greens: 3 } },
  { value: "Orthodox Christian", fx: { faith: 6 } },
  { value: "Sikh", fx: { faith: 3, civil_rights: 3 } },
  { value: "Non-religious", fx: { faith: -8 } },
];

export const MARITAL = [
  { value: "Married w/ Children", label: "👨‍👩‍👧 Married w/ Children", sub: "Traditional, safe", fx: { faith: 4 } },
  { value: "Married, No Children", label: "💑 Married, No Children", sub: "Mostly neutral", fx: {} },
  { value: "Divorced / Remarried", label: "📋 Divorced / Remarried", sub: "−Evangelicals slightly", fx: { faith: -5 } },
  { value: "Single / Unmarried", label: "🧑 Single / Unmarried", sub: "+Novelty, −Traditionalists", fx: { approval: 1, faith: -6 } },
  { value: "Widowed", label: "🕊️ Widowed", sub: "+Sympathy", fx: { approval: 2, faith: 2 } },
];

export const EDUCATION = [
  { value: "Ivy League", label: "🎓 Ivy League", sub: "+Institutions, −Populists", fx: { stability: 4, big_business: 5, approval: -1 } },
  { value: "State University", label: "🏫 State University", sub: "Balanced", fx: {} },
  { value: "Military Academy", label: "⭐ Military Academy", sub: "+Pentagon, +Veterans", fx: { pentagon: 10, stability: 2 } },
  { value: "Top Law School", label: "⚖️ Top Law School", sub: "+Gov stability", fx: { stability: 5 } },
  { value: "Self-Made / No Degree", label: "🔧 Self-Made / No Degree", sub: "+Labour, −Institutions", fx: { labor: 7, approval: 1, stability: -3 } },
];

export const WEALTH = [
  { value: "Working Class Origins", label: "🏗️ Working Class Origins", sub: "+Labour, −Wall St", fx: { labor: 10, wall_street: -6 } },
  { value: "Middle Class", label: "🏠 Middle Class", sub: "Balanced", fx: {} },
  { value: "Old Money / Inherited", label: "🏛️ Old Money / Inherited", sub: "+Institutions, −Populists", fx: { wall_street: 7, stability: 3, approval: -2 } },
  { value: "Self-Made Millionaire", label: "💰 Self-Made Millionaire", sub: "+Business, mixed", fx: { big_business: 8, labor: -3 } },
  { value: "Billionaire", label: "🏦 Billionaire", sub: "+Wall St, −Labour", fx: { wall_street: 12, big_business: 6, labor: -8 } },
];

export const BACKGROUNDS = [
  { value: "Military / Intelligence", label: "🎖️ Military / Intelligence", sub: "+Pentagon, +Veterans", fx: { pentagon: 12, stability: 3 } },
  { value: "Business / Corporate", label: "💼 Business / Corporate", sub: "+Wall St, +Chamber", fx: { wall_street: 9, big_business: 9, labor: -4 } },
  { value: "Law / Prosecutor", label: "⚖️ Law / Prosecutor", sub: "+Law & order", fx: { gun_owners: 5, stability: 4 } },
  { value: "Community Organizer", label: "✊ Community Organizer", sub: "+Civil rights, +Progressives", fx: { civil_rights: 12, labor: 6, wall_street: -5 } },
  { value: "Governor", label: "🏛️ Governor", sub: "Balanced, +Institutions", fx: { stability: 6 } },
  { value: "Senator / Congress", label: "📜 Senator / Congress", sub: "+Gov stability", fx: { stability: 7, approval: -1 } },
  { value: "Outsider / Mogul", label: "🔥 Outsider / Mogul", sub: "+Populist, −Establishment", fx: { approval: 2, stability: -6, big_business: -4 } },
];

export const MILITARY = [
  { value: "No Service", fx: {} },
  { value: "Combat Veteran", label: "🎖️ Combat Veteran", sub: "+Pentagon, +Polling", fx: { pentagon: 10, approval: 2 } },
  { value: "Career Officer", label: "⭐ Career Officer", sub: "+Gov stability, +Military", fx: { pentagon: 8, stability: 4 } },
  { value: "Guard / Reserves", label: "🪖 Guard / Reserves", sub: "Small military bonus", fx: { pentagon: 4 } },
  { value: "Conscientious Objector", label: "☮️ Conscientious Objector", sub: "+Progressives, −Military", fx: { pentagon: -10, greens: 6, civil_rights: 5 } },
];

export const SCANDALS = [
  { value: "Clean Record", label: "✨ Clean Record", sub: "+Gov stability", fx: { stability: 5 } },
  { value: "Business Controversy", label: "💼 Business Controversy", sub: "−Institutions", fx: { stability: -6, approval: -2 } },
  { value: "Personal Scandal", label: "🔥 Personal Scandal", sub: "−Evangelicals, −Media", fx: { faith: -10, approval: -3 } },
  { value: "Corruption Allegations", label: "⚠️ Corruption Allegations", sub: "−Institutions, +Base rally", fx: { stability: -10, approval: 1 } },
  { value: "No Political Record", label: "🆕 No Political Record", sub: "+Outsider energy", fx: { approval: 2, stability: -3 } },
];

/** Home region → the states that get a favourite-son bump. */
export const REGIONS = [
  { value: "Northeast", label: "🏙️ Northeast", states: ["NY", "NJ", "CT", "MA", "RI", "VT", "NH", "ME", "PA"] },
  { value: "South", label: "🏡 South", states: ["TX", "FL", "GA", "AL", "MS", "LA", "SC", "NC", "TN", "AR"] },
  { value: "Midwest", label: "🌾 Midwest", states: ["OH", "MI", "WI", "MN", "IA", "IL", "IN", "MO", "KS", "NE"] },
  { value: "West Coast", label: "🌊 West Coast", states: ["CA", "OR", "WA"] },
  { value: "Mountain West", label: "🏔️ Mountain West", states: ["CO", "UT", "NV", "AZ", "NM", "MT", "ID", "WY"] },
  { value: "custom", label: "✏️ Custom", sub: "Pick a specific state", states: [], custom: true },
];

/** Field definitions, in the order the setup screen renders them. */
export const PROFILE_FIELDS = [
  { key: "age", label: "Age", options: AGES, layout: "grid" },
  { key: "race", label: "Race / Ethnicity", options: RACES, layout: "wrap" },
  { key: "religion", label: "Religion", options: RELIGIONS, layout: "wrap" },
  { key: "marital", label: "Marital Status", options: MARITAL, layout: "grid" },
  { key: "education", label: "Education", options: EDUCATION, layout: "grid" },
  { key: "wealth", label: "Wealth", options: WEALTH, layout: "grid" },
  { key: "background", label: "Background / Career", options: BACKGROUNDS, layout: "grid" },
  { key: "military", label: "Military Service", options: MILITARY, layout: "grid" },
  { key: "scandal", label: "Scandal History", options: SCANDALS, layout: "grid" },
  { key: "region", label: "Home Region", options: REGIONS, layout: "grid" },
];

export const PROFILE_DEFAULTS = {
  age: "50s",
  customAge: "",
  race: "White",
  religion: "Protestant",
  marital: "Married w/ Children",
  education: "State University",
  wealth: "Middle Class",
  background: "Governor",
  military: "No Service",
  scandal: "Clean Record",
  region: "Midwest",
  customState: "",
};

/** Collect the effects of a whole profile into one flat object. */
export function profileEffects(draft) {
  const all = {};
  for (const field of PROFILE_FIELDS) {
    const chosen = field.options.find((o) => o.value === draft[field.key]);
    for (const [k, v] of Object.entries(chosen?.fx || {})) {
      all[k] = (all[k] || 0) + v;
    }
  }
  return all;
}

/** The states that should get the home-region bump. */
export function homeStates(draft) {
  if (draft.region === "custom") return draft.customState ? [draft.customState] : [];
  return REGIONS.find((r) => r.value === draft.region)?.states || [];
}
