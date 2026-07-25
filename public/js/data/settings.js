"use strict";

/**
 * The rules-of-play rack on the setup screen.
 *
 * Every entry here changes how a term actually runs — the descriptions say
 * what the switch does, not what it is called. `tone` picks the card tint so
 * related rules read as a family: blue for the machinery of government, red
 * for conflict, green for measurement, amber for how events are written.
 */

export const SETTINGS = [
  {
    key: "economy", kind: "toggle", tone: "", default: true,
    title: "📈 Economic Simulation",
    desc: "Track GDP, unemployment, inflation and the national debt. Your policies move all four, and voters feel them.",
  },
  {
    key: "checks", kind: "toggle", tone: "blue", default: true,
    title: "⚖️ Checks & Balances",
    desc: "Congress, the courts and federal agencies can block or water down what you sign. Forces realism.",
  },
  {
    key: "bio", kind: "toggle", tone: "amber", default: false,
    title: "📝 Custom Bio",
    desc: "Fill out a short guided form about your president — campaign promises, family, past scandals, signature issues. Events tailored to them get mixed into the pool all term.",
  },
  {
    key: "persona", kind: "segmented", tone: "red", default: "off",
    title: "🤪 Persona Mode",
    desc: "Who the thirty voters in your focus group are.",
    options: [
      { value: "off", label: "Off", note: "Realistic voter personas." },
      { value: "whacko", label: "🤪 Whacko", note: "The panel loses its grip on reality." },
      { value: "tweeter", label: "🐦 Tweeter", note: "Everyone is extremely online and nothing is real life." },
    ],
  },
  {
    key: "elections", kind: "segmented", tone: "blue", default: "classic",
    title: "🗳️ Elections",
    desc: "How the re-election is decided.",
    options: [
      { value: "classic", label: "Classic", note: "State-by-state electoral college maths." },
      { value: "alternative", label: "Alternative", note: "Simpler — decided almost entirely by national approval." },
    ],
  },
  {
    key: "society", kind: "toggle", tone: "green", default: false,
    title: "📊 Social Engineering Mode",
    desc: "Track national statistics — population, crime, poverty, life expectancy, literacy and unrest. Your policies reshape the country, not just the polls.",
    warn: "Adds a second model call per month, so turns take longer.",
  },
  {
    key: "events", kind: "segmented", tone: "amber", default: "hybrid",
    title: "⚡ Event Generation",
    desc: "Where each month's situation comes from.",
    options: [
      { value: "classic", label: "Classic", note: "Hand-written events only. Works with no API key." },
      { value: "hybrid", label: "Hybrid", note: "Hand-written events mixed into AI-written months." },
      { value: "dynamic", label: "Dynamic", note: "Every month written fresh by the model." },
    ],
  },
  {
    key: "war", kind: "segmented", tone: "red", default: "off",
    title: "⚔️ Deployments & War",
    desc: "Track ongoing conflicts and troop deployments. Eras start with the wars they inherited — escalate, draw down, withdraw or negotiate.",
    warn: "Casualties and troop levels feed straight back into approval.",
    options: [
      { value: "off", label: "Off", note: "No deployments or conflicts this game." },
      { value: "classic", label: "Classic", note: "Troop levels, casualties and a war-weariness clock." },
      { value: "strategic", label: "Strategic", note: "Adds fronts, objectives and negotiated settlements." },
    ],
  },
  {
    key: "covert", kind: "toggle", tone: "green", default: false, tag: "'90s onward",
    title: "🎯 Covert Operations",
    desc: "A situation screen for the intelligence war: hunt networks in their havens, penetrate the cells, harden the homeland. Operations leak, plots get through, and a country left to fester produces an attack.",
  },
  {
    key: "weekly", kind: "toggle", tone: "blue", default: false,
    title: "🗓️ Weekly Pacing",
    desc: "One turn per week instead of per month — 208 turns across the term instead of 48. Every turn is a real event, just at a finer grain.",
    warn: "A full term takes far longer to play.",
  },
  {
    key: "radicals", kind: "toggle", tone: "red", default: false,
    title: "🗳️ Radicalised Government",
    desc: "Off, the 535 members of Congress, the nine justices and your own cabinet hold the ordinary politics of their party. On, the fringe takes over — theocrats, syndicalists, monarchists and accelerationists fill the benches, and you have to govern with them.",
    warn: "This is an alternate history, not a forecast. Everything downstream gets stranger.",
  },
  {
    key: "debates", kind: "toggle", tone: "purple", default: true,
    title: "🎤 Presidential Debates",
    desc: "Run the debate rounds when election season arrives. Switch off and the campaign is decided on your record alone.",
    sub: {
      key: "podium", kind: "toggle", default: false,
      title: "⏱️ Podium Clock",
      desc: "Answer against the clock instead of a character limit. When the moderator calls time, whatever you have said is what the country hears.",
    },
  },
];

export const DIFFICULTIES = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard", tag: "Recommended" },
];

export const NO_HINTS = {
  key: "noHints", default: false,
  title: "🔥 No Hints",
  desc: "No suggestions, no prompts, no placeholder ideas. You write every policy and campaign answer from a blank box.",
};

/** Starting values for everything on the rack. */
export function settingDefaults() {
  const out = { difficulty: "hard", noHints: NO_HINTS.default };
  for (const s of SETTINGS) {
    out[s.key] = s.default;
    if (s.sub) out[s.sub.key] = s.sub.default;
  }
  return out;
}

/** The guided-bio questions, asked only when Custom Bio is switched on. */
export const BIO_FIELDS = [
  { key: "promise", label: "Your signature campaign promise",
    placeholder: "The one thing you told the country you would do…", max: 200 },
  { key: "issue", label: "The issue you actually care about",
    placeholder: "What you would spend political capital on even if it polled badly…", max: 200 },
  { key: "history", label: "How you got here",
    placeholder: "The office you held before, the race that made your name, who you beat…", max: 240 },
  { key: "family", label: "Your family",
    placeholder: "Spouse, children, who the public already knows about…", max: 200 },
  { key: "skeleton", label: "The thing that could still come out",
    placeholder: "A story your opponents have been sitting on…", max: 200 },
  { key: "enemy", label: "Your most dangerous rival",
    placeholder: "Inside your own party or outside it — who is waiting for you to fail?", max: 200 },
];
