"use strict";

/**
 * Static catalogs for the setup flow. Everything the player picks here ends up
 * on `state.scenario`, so every option has to mean something to the engine or
 * to the prompt that writes the month — nothing is decorative.
 */

/** Scenarios. Those with `eras` show the era picker; the rest start directly. */
export const SCENARIOS = [
  {
    key: "modern", icon: "🏛️", name: "Modern Era",
    desc: "2013–2025. ACA fights, the populist turn, COVID, the polarization era.",
    eras: [
      {
        key: "2025-01", icon: "📱", title: "January 2025", startYear: 2025,
        desc: "Polarized America. AI boom. Ukraine war ongoing. Inflation cooling. Inherits a 6–3 court and a narrow Congress.",
        prose: "January 2025. A deeply polarized America in an AI boom, with the war in Ukraine grinding on, inflation finally cooling, a 6–3 conservative Supreme Court and razor-thin margins in Congress.",
        court: { conservative: 6, liberal: 3 },
      },
      {
        key: "2021-01", icon: "😷", title: "January 2021", startYear: 2021,
        desc: "COVID raging. Vaccines rolling out. The Capitol attack was two weeks ago. Inherits a 6–3 court.",
        prose: "January 2021. COVID-19 is raging, the first vaccines are rolling out, the Capitol was attacked two weeks ago, and the country is exhausted and furious. A 6–3 conservative Supreme Court and the slimmest of Senate majorities.",
        court: { conservative: 6, liberal: 3 },
      },
      {
        key: "2017-01", icon: "📊", title: "January 2017", startYear: 2017,
        desc: "Populist surge. ISIS being rolled back. Refugee crisis. Inherits a 4–4 court with a vacancy.",
        prose: "January 2017. A populist surge has upended both parties, ISIS is being rolled back in Iraq and Syria, Europe is straining under a refugee crisis, and a Supreme Court seat sits vacant at 4–4.",
        court: { conservative: 4, liberal: 4 },
      },
      {
        key: "2013-01", icon: "📡", title: "January 2013", startYear: 2013,
        desc: "ISIS rising. Snowden ahead. The healthcare rollout is about to land. Split Congress.",
        prose: "January 2013. ISIS is rising in the vacuum, a vast surveillance leak is months away, and a troubled national healthcare rollout is about to land on your desk. Congress is split and the court sits 5–4.",
        court: { conservative: 5, liberal: 4 },
      },
    ],
  },
  {
    key: "2000s", icon: "🗽", name: "The 2000s",
    desc: "2001–2013. 9/11, the Iraq War, the financial crisis, a historic first term.",
    eras: [
      {
        key: "2009-01", icon: "📉", title: "January 2009", startYear: 2009,
        desc: "Worst recession since 1929. Iraq drawdown. Afghan surge ahead. Supermajority Congress.",
        prose: "January 2009. The worst financial collapse since 1929 is still unfolding, banks are failing, Iraq is winding down and Afghanistan is winding up. Your party holds enormous majorities and the country expects miracles.",
        court: { conservative: 5, liberal: 4 },
      },
      {
        key: "2005-01", icon: "⚔️", title: "January 2005", startYear: 2005,
        desc: "The Iraq insurgency is raging. Katrina ahead. A financial bubble is inflating.",
        prose: "January 2005. The insurgency in Iraq is raging, a catastrophic hurricane season is coming, and a housing bubble is quietly inflating under a booming economy.",
        court: { conservative: 5, liberal: 4 },
      },
      {
        key: "2001-01", icon: "🌆", title: "January 2001", startYear: 2001,
        desc: "The dot-com bubble is bursting. A contested election just ended. Peace, briefly.",
        prose: "January 2001. The dot-com bubble is bursting, you arrive from a bitterly contested election, and the world is quiet in a way it will not stay.",
        court: { conservative: 5, liberal: 4 },
      },
    ],
  },
  {
    key: "nineties", icon: "📰", name: "The Nineties",
    desc: "1993–2001. Cold War over, NAFTA, the dot-com boom, talk radio rising.",
    eras: [
      {
        key: "1997-01", icon: "💻", title: "January 1997", startYear: 1997,
        desc: "Booming economy, balanced-budget fights, the internet arrives, scandal politics sharpen.",
        prose: "January 1997. The economy is roaring, the budget is close to balance, the internet is arriving in every home, and a new scandal-driven politics is sharpening in Washington.",
        court: { conservative: 5, liberal: 4 },
      },
      {
        key: "1993-01", icon: "🗞️", title: "January 1993", startYear: 1993,
        desc: "Cold War just ended. Recession lingering. Healthcare reform and NAFTA on the table.",
        prose: "January 1993. The Cold War has just ended, a recession is lingering, and healthcare reform and a continental trade deal are both waiting on your desk.",
        court: { conservative: 5, liberal: 4 },
      },
    ],
  },
  {
    key: "sixties", icon: "📺", name: "The Sixties",
    desc: "1961–1969. Cold War, civil rights, Vietnam, the space race.",
    eras: [
      {
        key: "1965-01", icon: "🚀", title: "January 1965", startYear: 1965,
        desc: "Vietnam escalating. The civil-rights fight moves to voting. The Great Society begins.",
        prose: "January 1965. Vietnam is escalating fast, the civil-rights movement has turned to voting rights, and an enormous domestic reform agenda is within reach of a huge congressional majority.",
        court: { conservative: 3, liberal: 6 },
      },
      {
        key: "1961-01", icon: "🌍", title: "January 1961", startYear: 1961,
        desc: "Cold War at its coldest. Cuba, Berlin and the space race all waiting.",
        prose: "January 1961. The Cold War is at its coldest — Cuba, Berlin and the space race are all waiting, and nuclear brinkmanship is a monthly reality.",
        court: { conservative: 4, liberal: 5 },
      },
    ],
  },
  {
    key: "fifties", icon: "🏛️", name: "The Fifties",
    desc: "1949–1958. The Cold War, Korea, McCarthyism, and the postwar boom.",
    eras: [
      {
        key: "1953-01", icon: "🎖️", title: "January 1953", startYear: 1953,
        desc: "Korea stalemated. McCarthy at his peak. The hydrogen bomb changes everything.",
        prose: "January 1953. Korea is stalemated, a senator's anti-communist crusade is at its peak, and the hydrogen bomb has just changed what war means.",
        court: { conservative: 4, liberal: 5 },
      },
      {
        key: "1949-01", icon: "🕊️", title: "January 1949", startYear: 1949,
        desc: "Berlin airlift underway. NATO being written. The postwar boom begins.",
        prose: "January 1949. Berlin is being supplied by air, a new Atlantic alliance is being written, and the postwar boom is just beginning at home.",
        court: { conservative: 4, liberal: 5 },
      },
    ],
  },
  {
    key: "challenges", icon: "🔥", name: "Challenges", variant: "feature",
    desc: "Start in crisis, on the back foot, with the country already against you. Can you dig yourself out?",
    eras: [
      {
        key: "chal-crash", icon: "💥", title: "The Crash", startYear: 2026,
        desc: "Markets in free-fall the week you are sworn in. Start at 34% approval.",
        prose: "You are sworn in the same week the markets fall off a cliff. Credit has frozen, layoffs are announced hourly, and nobody believes anything you say yet.",
        court: { conservative: 6, liberal: 3 }, approval: 34, stability: 52,
      },
      {
        key: "chal-scandal", icon: "🗃️", title: "Inherited Scandal", startYear: 2026,
        desc: "A predecessor's scandal lands on you in week one. Congress is hostile. Start at 31%.",
        prose: "Your predecessor's scandal broke the week you took office, and the subpoenas have your administration's name on them. Congress is hostile and the press smells blood.",
        court: { conservative: 6, liberal: 3 }, approval: 31, stability: 44,
      },
      {
        key: "chal-brink", icon: "☢️", title: "The Brink", startYear: 2026,
        desc: "A nuclear-armed rival is mobilizing on day one. Allies are wavering. Start at 38%.",
        prose: "A nuclear-armed rival began mobilizing the day you took the oath. Your allies are wavering, your intelligence is thin, and the clock is not yours.",
        court: { conservative: 6, liberal: 3 }, approval: 38, stability: 48,
      },
    ],
  },
  {
    key: "custom", icon: "✨", name: "Create Your Own", variant: "new",
    desc: "Build a custom president from scratch. Choose party, ideology, mandate and more.",
    era: {
      key: "custom", title: "Present day", startYear: 2025,
      prose: "The present day. A polarized nation, thin margins in Congress and a restless electorate.",
      court: { conservative: 6, liberal: 3 },
    },
  },
];

export const GENDERS = [
  { value: "male", label: "♂ Male" },
  { value: "female", label: "♀ Female" },
];

export const PARTIES = [
  { value: "Democrat", label: "Democrat", cls: "dem" },
  { value: "Republican", label: "Republican", cls: "rep" },
  { value: "Independent", label: "Independent", cls: "ind" },
];

export const IDEOLOGIES = {
  Democrat: [
    { value: "Progressive Firebrand", sub: "+Base energy, −Moderates" },
    { value: "Liberal Mainstream", sub: "Balanced" },
    { value: "Blue Dog Moderate", sub: "+Swing voters, −Base" },
    { value: "Democratic Socialist", sub: "+Labor, −Wall St" },
    { value: "New Left", sub: "+Civil rights coalition, −Right media" },
  ],
  Republican: [
    { value: "Populist Right", sub: "+Base energy, −Moderates" },
    { value: "Traditional Conservative", sub: "Balanced" },
    { value: "Moderate Republican", sub: "+Swing voters, −Base" },
    { value: "Libertarian Conservative", sub: "+Libertarian wing, −Religious right" },
    { value: "Religious Right", sub: "+Faith communities, −Big tech" },
    { value: "Neoconservative", sub: "+Pentagon & Wall St, −Populists" },
  ],
  Independent: [
    { value: "Reform Populist", sub: "+Reform base, −Wall St & establishment" },
    { value: "Democratic Socialist", sub: "+Labor & the left, −Big business" },
    { value: "Christian Nationalist", sub: "+Religious right, −Secularists" },
    { value: "Libertarian", sub: "+Free-market & gun-rights voters, −Regulators" },
    { value: "Green", sub: "+Environmentalists, −Fossil fuels" },
  ],
};

export const STYLES = [
  { value: "Polished / Presidential", sub: "+Media, +Institutions" },
  { value: "Populist / Direct", sub: "+Base, −Establishment" },
  { value: "Academic / Wonky", sub: "+Higher ed, −Mass appeal" },
  { value: "Folksy / Relatable", sub: "+Polling, +Midwest" },
  { value: "Combative", sub: "+Base energy, −Swing voters" },
];

export const MANDATES = [
  { value: "landslide", label: "🏆 Landslide Victory", sub: "Start 55% approval", approval: 55 },
  { value: "comfortable", label: "✅ Comfortable Win", sub: "Start 50% approval", approval: 50 },
  { value: "razor", label: "🔪 Razor-Thin Margin", sub: "Start 44% approval", approval: 44 },
  { value: "college", label: "⚡ Electoral College Only", sub: "Start 40%, high party loyalty", approval: 40 },
];

/** Seat splits, expressed from the president's party's point of view. */
export const COMPOSITIONS = [
  { value: "supermajority", label: "🔵 Generational Supermajority", sub: "Historic landslide — ~165-seat House lead, 70–30 Senate (veto-proof)", house: 300, senate: 70 },
  { value: "strong", label: "🟢 Strong Majority", sub: "Both chambers, ~75-seat House lead, 58–42 Senate", house: 255, senate: 58 },
  { value: "weak", label: "🟡 Weak Majority", sub: "Both chambers, ~20-seat House lead, 53–47 Senate", house: 228, senate: 53 },
  { value: "balanced", label: "⚖️ Balanced", sub: "No clear majority. House +1, 50–50 Senate", house: 218, senate: 50 },
  { value: "weak_minority", label: "🟠 Weak Minority", sub: "Opposition holds both, ~20-seat deficit, 47–53 Senate", house: 207, senate: 47 },
  { value: "strong_minority", label: "🔴 Strong Minority", sub: "Opposition supermajority, ~75-seat deficit, 42–58 Senate", house: 180, senate: 42 },
];

/** Running-mate generation pools. */
export const VP_POOL = {
  first: {
    male: ["Andrew", "Jorge", "Marcus", "Daniel", "Robert", "Elias", "Nathan", "Terrence", "Victor", "Samuel"],
    female: ["Cynthia", "Diane", "Patricia", "Alma", "Rosa", "Katherine", "Nadia", "Joan", "Beatrice", "Simone"],
  },
  last: ["Green", "Cook", "Murphy", "Espinoza", "Diaz", "Whitfield", "Okafor", "Lindqvist", "Barrera", "Kowalski", "Nakamura", "Aldridge"],
  region: ["south", "northeast", "midwest", "west coast", "mountain west"],
  background: ["governor", "senator", "outsider", "law", "business", "military"],
};

export const PORTFOLIOS = [
  { value: "", label: "— No portfolio —" },
  { value: "economy", label: "The economy & jobs" },
  { value: "security", label: "National security" },
  { value: "health", label: "Health & environment" },
  { value: "justice", label: "Law & justice" },
  { value: "foreign", label: "Foreign affairs" },
];
