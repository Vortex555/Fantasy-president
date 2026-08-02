import { seeded, clamp, round1 } from "./rng.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "./states.js";
import { vpSupports } from "./succession.js";
import { factionById } from "../public/js/data/factions.js";

/**
 * Bills on your desk.
 *
 * Congress writes legislation near its own centre of gravity, so what lands on
 * your desk is decided by who is actually in the chamber — a House full of
 * syndicalists sends nationalisation bills, a House full of business
 * Republicans sends deregulation. Only bills that clear both chambers reach
 * you, and then you have exactly two options.
 *
 * Vetoing is not free. A bill that passed on a wide margin will be overridden,
 * and an override is a public humiliation that costs more than signing would
 * have. The reason to veto is when the bill itself is worse than the beating.
 */

/**
 * How contested a bill is, which is not the same question as where it sits.
 *
 * The roll call had one dimension and it could not express the commonest fact
 * about a real legislature: that some bills are not fought over. Because support
 * was purely a function of ideological distance, and the two caucuses sit about
 * 0.8 apart while the agreement window is only ±0.44 wide, *every* bill was a
 * party-line vote with the cutline in a different place. The most bipartisan
 * bill the engine could produce got 39 votes in a hundred-seat Senate and
 * failed. Nothing could ever pass 85–15.
 *
 * So a bill now carries a second value: how much of the chamber feels it cannot
 * be seen voting against. It widens the window rather than moving it, so a
 * consensus bill keeps its politics — the sponsor is still whoever believes in
 * it, the stances still lean — while picking up the people who would normally
 * be out of reach. Disaster relief, defending the country after an attack,
 * honouring the dead and naming a post office all live here.
 */
export const CONSENSUS = {
  /** Nobody will be recorded against it. A post office, a memorial. */
  unanimous: 0.95,
  /** Disaster relief, homeland defence after an attack, veterans' care. */
  bipartisan: 0.55,
  /** A normal bill that picks up some of the other side. */
  contested: 0.25,
  /** A party-line vote. What the engine used to assume about everything. */
  partyline: 0,
};

export const CONSENSUS_TIERS = Object.keys(CONSENSUS);

/**
 * A bill's `axis` is its position on the same −1…+1 spectrum as an ideology,
 * and `liberty` is the second one: what the state may do to a person.
 *
 * `liberty` is salience, not flavour, and most bills leave it out entirely. The
 * test is whether state power over a person is *the question the bill asks* —
 * warrants, policing, detention, censorship, emergency powers — not whether the
 * bill has a libertarian tint. Abolishing the Fed and nationalising the railways
 * are arguments about who gets what, and both sat far too high here on the first
 * pass, which pulled a radicalised chamber apart on a dimension those bills are
 * not actually about. Where it is 0 every number in the game is exactly what it
 * was before the dimension existed. See `stanceFit`.
 */
export const BILL_POOL = [
  // --- Left ---------------------------------------------------------------
  { id: "nationalise_rail", axis: -0.92, economic: -0.9, diplomatic: 0.3, culture: 0, domain: "economy",
    title: "Rail Nationalisation Act",
    brief: "Takes the freight and passenger networks into public ownership at assessed value, with a federal operating authority.",
    fx: { approval: -1, labor: 14, wall_street: -16, big_business: -14, economy: { debt: 1.4, gdpGrowth: -0.2 } } },
  { id: "wealth_tax", axis: -0.82, economic: -0.9, diplomatic: 0, culture: 0, domain: "economy",
    title: "Extreme Wealth Tax Act",
    brief: "An annual levy on net worth above fifty million dollars, collected by a new Treasury division.",
    fx: { approval: 1.5, labor: 12, wall_street: -20, big_business: -12, economy: { debt: -1.6 } } },
  { id: "jobs_guarantee", axis: -0.72, economic: -0.85, diplomatic: 0, culture: 0, domain: "economy",
    title: "Federal Jobs Guarantee",
    brief: "Guarantees a public-option job at a living wage to any adult who wants one, administered through the states.",
    fx: { approval: 2, labor: 16, wall_street: -10, economy: { unemployment: -1.1, debt: 2.2, inflation: 0.4 } },
    society: { poverty: -1.4, unrest: -6 } },
  { id: "green_transition", axis: -0.62, economic: -0.5, diplomatic: -0.3, culture: -0.4, domain: "health",
    title: "National Decarbonisation Act",
    brief: "Sunsets fossil generation on a ten-year clock and funds the replacement grid.",
    fx: { approval: 0.5, greens: 18, labor: -6, big_business: -10, economy: { debt: 1.8, gdpGrowth: -0.2 } } },
  { id: "universal_care", axis: -0.55, economic: -0.8, diplomatic: 0, culture: 0, pluralism: 0.3, domain: "health",
    title: "Universal Coverage Act",
    brief: "Extends federal health coverage to every resident, funded by payroll and premium reform.",
    fx: { approval: 2.5, labor: 12, civil_rights: 8, big_business: -8, economy: { debt: 2.4 } },
    society: { uninsured: -6, lifeExpectancy: 0.4 } },
  { id: "union_rights", axis: -0.48, economic: -0.8, diplomatic: 0.2, culture: 0, domain: "economy",
    consensus: CONSENSUS.partyline,
    title: "Organising Rights Restoration Act",
    brief: "Bans captive-audience meetings, permits card-check recognition and penalises retaliatory dismissal.",
    fx: { approval: 0.5, labor: 18, big_business: -12, wall_street: -6 } },
  { id: "voting_rights", axis: -0.42, economic: 0, diplomatic: 0, liberty: 0.4, culture: -0.4, pluralism: 0.8, domain: "justice",
    consensus: CONSENSUS.partyline,
    title: "Voting Access Act",
    brief: "Sets a federal floor for early voting, mail ballots and same-day registration.",
    fx: { approval: 1, civil_rights: 16, faith: -5, gun_owners: -4 } },
  { id: "childcare", axis: -0.35, economic: -0.6, diplomatic: 0, culture: -0.2, pluralism: 0.2, domain: "social",
    consensus: CONSENSUS.contested,
    title: "Universal Childcare Act",
    brief: "Caps childcare costs at seven per cent of household income, with federal top-up payments.",
    fx: { approval: 3, labor: 8, faith: 4, economy: { debt: 1.2 } },
    society: { poverty: -0.8 } },
  { id: "housing_supply", axis: -0.18, economic: 0.2, diplomatic: 0, culture: 0, domain: "social",
    consensus: CONSENSUS.contested,
    title: "Housing Supply Act",
    brief: "Ties federal transport money to local permitting reform and funds two million new units.",
    fx: { approval: 2, labor: 6, big_business: 6, greens: -5, economy: { debt: 0.9 } },
    society: { homeownership: 1.2 } },

  // --- Centre -------------------------------------------------------------
  { id: "infrastructure", axis: -0.05, economic: 0, diplomatic: 0.2, culture: 0, domain: "economy",
    // Roads and bridges buy votes in every district.
    consensus: CONSENSUS.bipartisan,
    title: "Bridges and Ports Act",
    brief: "A decade of federal spending on roads, bridges, ports and water systems, split by formula.",
    fx: { approval: 3.5, labor: 10, big_business: 8, economy: { gdpGrowth: 0.4, debt: 1.6, unemployment: -0.3 } } },
  { id: "chips_research", axis: 0.02, economic: 0, diplomatic: 0.6, culture: 0, domain: "economy",
    // Onshoring is one of the few things both sides want.
    consensus: CONSENSUS.bipartisan,
    title: "Domestic Manufacturing Act",
    brief: "Subsidises advanced manufacturing onshore, with clawbacks for firms that offshore afterwards.",
    fx: { approval: 2.5, big_business: 10, labor: 8, economy: { gdpGrowth: 0.3, debt: 1.1 } } },
  { id: "veterans_care", axis: 0.08, economic: -0.2, diplomatic: 0.3, culture: 0.2, domain: "security",
    // Nobody is recorded against veterans' care.
    consensus: CONSENSUS.unanimous,
    title: "Veterans Care Expansion",
    brief: "Expands service-connected coverage and funds the backlog of pending claims.",
    fx: { approval: 3, pentagon: 12, faith: 5, economy: { debt: 0.6 } } },
  { id: "opioid_response", axis: 0.12, economic: -0.3, diplomatic: 0, culture: 0, domain: "health",
    // Rural clinics are not a partisan question.
    consensus: CONSENSUS.bipartisan,
    title: "Rural Health and Recovery Act",
    brief: "Funds treatment capacity and clinic staffing in counties with no obstetric or addiction services.",
    fx: { approval: 2.5, faith: 8, labor: 6, economy: { debt: 0.7 } },
    society: { lifeExpectancy: 0.3 } },
  /**
   * The cross-cutting pair.
   *
   * Both sit near the middle on money and at opposite poles on state power,
   * which is the combination the single axis could not hold: read on economics
   * alone they are indistinguishable centrist bills, and the chamber divided on
   * them by party. Now leadership takes one side and both organised wings take
   * the other, which is how every surveillance vote of the last twenty years has
   * actually gone.
   *
   * Both sat at ±0.85 on the first pass and the reform bill lost 73-362, because
   * the chamber's liberty median is about -0.1 and 0.85 is a fringe position
   * measured against it — the same mistake as writing a bill at axis +0.9 and
   * being surprised. At ±0.58 the vote lands within twenty of the line, which is
   * where warrant amendments actually land and the only place a player's own
   * vote is worth anything.
   */
  { id: "surveillance_reform", axis: -0.1, economic: 0, diplomatic: 0, liberty: 0.58, culture: 0, pluralism: 0.3, domain: "justice",
    consensus: CONSENSUS.contested,
    title: "Warrant Requirement Act",
    brief: "Requires a judicial warrant before federal agencies may query Americans' communications, and forces disclosure of data breaches.",
    fx: { approval: 2, civil_rights: 14, gun_owners: 8, pentagon: -16, big_business: -8 },
    society: { crime: 3 } },
  { id: "surveillance_powers", axis: 0.2, economic: 0, diplomatic: 0.2, liberty: -0.58, culture: 0.2, pluralism: -0.35, domain: "justice",
    consensus: CONSENSUS.contested,
    title: "Intelligence Authorities Reauthorisation",
    brief: "Renews bulk collection authorities for five years and extends them to data bought from commercial brokers.",
    fx: { approval: -1, pentagon: 18, big_business: 8, civil_rights: -20, gun_owners: -10 },
    society: { crime: -6, unrest: 4 } },

  { id: "budget_deal", axis: 0.18, economic: 0.3, diplomatic: 0, culture: 0, domain: "economy",
    // It is a compromise by construction.
    consensus: CONSENSUS.bipartisan,
    title: "Bipartisan Budget Compromise",
    brief: "A two-year deal that keeps the government open and trims discretionary growth.",
    fx: { approval: 1.5, wall_street: 8, big_business: 6, labor: -6, economy: { debt: -1.2 } } },

  // --- Right --------------------------------------------------------------
  { id: "border_enforcement", axis: 0.38, economic: 0, diplomatic: 0.8, liberty: -0.5, culture: 0.4, pluralism: -0.6, domain: "security",
    consensus: CONSENSUS.contested,
    title: "Border Enforcement Act",
    brief: "Funds physical barriers, detention capacity and eight thousand additional agents.",
    fx: { approval: 1, gun_owners: 10, faith: 8, civil_rights: -14, economy: { debt: 0.8 } },
    society: { unrest: 5, population: -0.2 } },
  { id: "tax_cuts", axis: 0.45, economic: 0.9, diplomatic: 0, culture: 0, domain: "economy",
    title: "Growth and Investment Act",
    brief: "Cuts corporate and top marginal rates and makes prior expensing provisions permanent.",
    fx: { approval: 0.5, wall_street: 18, big_business: 16, labor: -10, economy: { gdpGrowth: 0.4, debt: 2.6 } } },
  { id: "deregulation", axis: 0.52, economic: 0.8, diplomatic: 0, liberty: 0.3, culture: 0, domain: "economy",
    title: "Regulatory Relief Act",
    brief: "Requires two rules repealed for each new one and strips agencies of independent rulemaking.",
    fx: { approval: -0.5, big_business: 16, wall_street: 12, greens: -16, economy: { gdpGrowth: 0.3 } } },
  { id: "defence_buildup", axis: 0.55, economic: 0.2, diplomatic: 0.5, liberty: -0.15, culture: 0.2, domain: "security",
    consensus: CONSENSUS.contested,
    title: "Defence Modernisation Act",
    brief: "A shipbuilding and munitions expansion with a five-year procurement floor.",
    fx: { approval: 1, pentagon: 18, big_business: 8, economy: { debt: 2.2, gdpGrowth: 0.2 } } },
  { id: "school_choice", axis: 0.6, economic: 0.5, diplomatic: 0, liberty: 0.25, culture: 0.6, pluralism: -0.2, domain: "social",
    title: "Education Freedom Act",
    brief: "Converts federal education funding into portable accounts families can spend anywhere.",
    fx: { approval: 0, faith: 16, labor: -14, economy: {} },
    society: { literacy: -0.4 } },
  { id: "crime_bill", axis: 0.65, economic: 0, diplomatic: 0.2, liberty: -0.8, culture: 0.5, pluralism: -0.45, domain: "justice",
    consensus: CONSENSUS.contested,
    title: "Public Order Act",
    brief: "Mandatory minimums for armed offences and a federal grant programme for police hiring.",
    fx: { approval: 1.5, gun_owners: 12, pentagon: 6, civil_rights: -18 },
    society: { crime: -22, unrest: 4 } },
  { id: "entitlement_reform", axis: 0.72, economic: 0.8, diplomatic: 0, culture: 0.2, domain: "economy",
    title: "Entitlement Solvency Act",
    brief: "Raises the retirement age on a schedule and means-tests the upper benefit tier.",
    fx: { approval: -4, wall_street: 14, labor: -16, faith: -6, economy: { debt: -3.2 } },
    society: { poverty: 1.1 } },

  // --- Fringe: only a radicalised chamber writes these ---------------------
  { id: "abolish_fed", axis: 0.88, economic: 0.7, diplomatic: 0.4, liberty: 0.25, culture: 0.2, domain: "economy", fringe: true,
    title: "Federal Reserve Abolition Act",
    brief: "Winds up the central bank and returns monetary authority to Treasury and the states.",
    fx: { approval: -3, wall_street: -24, big_business: -14, gun_owners: 10, economy: { inflation: 2.4, gdpGrowth: -0.8 } } },
  { id: "national_faith", axis: 0.92, economic: 0, diplomatic: 0.5, liberty: -0.6, culture: 0.95, pluralism: -0.7, domain: "social", fringe: true,
    title: "National Religious Heritage Act",
    brief: "Establishes scriptural instruction in federally funded schools and a national day of observance.",
    fx: { approval: -4, faith: 24, civil_rights: -26, big_business: -8 },
    society: { unrest: 12 } },
  { id: "abolish_income_tax", axis: 0.95, economic: 0.9, diplomatic: 0.3, liberty: 0.2, culture: 0.2, domain: "economy", fringe: true,
    title: "Income Tax Repeal Act",
    brief: "Repeals the federal income tax outright and funds the government from tariffs and excise.",
    fx: { approval: 2, wall_street: 10, big_business: 12, labor: -12, economy: { debt: 5.5, inflation: 1.2 } } },
  { id: "seize_industry", axis: -0.95, economic: -0.95, diplomatic: 0.3, liberty: -0.3, culture: 0, domain: "economy", fringe: true,
    title: "Commanding Heights Act",
    brief: "Brings energy, pharmaceuticals and heavy industry under public ownership and workers' councils.",
    fx: { approval: -4, labor: 26, wall_street: -30, big_business: -28, economy: { gdpGrowth: -1.2, debt: 3.4 } },
    society: { unrest: 14 } },
  { id: "max_income", axis: -0.88, economic: -0.9, diplomatic: 0, liberty: -0.15, culture: 0, domain: "economy", fringe: true,
    title: "Maximum Income Act",
    brief: "Caps total compensation at a fixed multiple of the federal minimum wage.",
    fx: { approval: -1, labor: 22, wall_street: -28, big_business: -22, economy: { gdpGrowth: -0.6 } } },
  { id: "degrowth_act", axis: -0.85, economic: -0.6, diplomatic: -0.3, liberty: -0.3, culture: -0.3, domain: "health", fringe: true,
    title: "Planetary Limits Act",
    brief: "Sets a declining statutory cap on national energy and material throughput.",
    fx: { approval: -6, greens: 26, labor: -14, big_business: -24, economy: { gdpGrowth: -1.6 } } },
];

export const billById = (id) => BILL_POOL.find((b) => b.id === id);

/**
 * A pool entry, in the shape the floor and the roll call read.
 *
 * Four separate places used to build this by hand, listing the fields they
 * happened to know about, and every one of them silently dropped `liberty` the
 * day it was added — so every hand-written bill in the game arrived on the floor
 * with the second axis zeroed and the whole dimension was inert outside
 * model-written months. A field added to a bill has to reach the vote, and one
 * projection is the only way that stays true.
 *
 * `consensus` is deliberately NOT carried. Pool entries hold it as a number and
 * `consensusOf` prefers a number over the `support` word, so copying it here
 * would make `crisisConsensus` unable to raise a bill's consensus in an
 * emergency — it sets `support`, and the number would outrank it. Left absent,
 * the id lookup in `consensusOf` recovers the pool value and the override still
 * works.
 */
export const scheduledBill = (source, extra = {}) => ({
  id: source.id,
  title: source.title,
  brief: source.brief,
  axis: source.axis,
  ...Object.fromEntries(ISSUE_AXES.map(({ id }) => [id, Number(source[id]) || 0])),
  ...(Array.isArray(source.topics) && source.topics.length ? { topics: source.topics } : {}),
  domain: source.domain,
  fringe: Boolean(source.fringe),
  ...(Array.isArray(source.defectors) && source.defectors.length
    ? { defectors: source.defectors } : {}),
  ...extra,
});

/**
 * How often the fringe gets floor time.
 *
 * "Fringe" here is editorial rather than arithmetic, and it has to be: the
 * hard-left `nationalise_rail` sits at -0.92 and is ordinary politics somewhere
 * in the world, while `max_income` at -0.88 is a different kind of proposal
 * entirely. What marks these six is that they change the regime rather than the
 * policy — abolish the central bank, establish a national religion, repeal the
 * income tax, take the commanding heights, cap what a person may earn, legislate
 * degrowth. You cannot infer that from a number, so the pool states it.
 *
 * Before this, the toggle was the whole mechanism: off meant such a bill could
 * never once reach the floor in a twenty-year career, and on meant they sat in
 * the pool competing on ordinary weighting. Neither is how a fringe behaves. A
 * normal legislature gives it the occasional slot — a messaging vote, a
 * concession to a caucus that has the numbers to demand one — and a radicalised
 * one is *made of* it.
 */
export const FRINGE_CHANCE = { normal: 0.05, radical: 0.5 };

export const fringeChance = (state) =>
  (state?.scenario?.radicals === true ? FRINGE_CHANCE.radical : FRINGE_CHANCE.normal);

/** The six, split by which end of the spectrum they come from. */
export const FRINGE_BILLS = BILL_POOL.filter((b) => b.fringe);

/**
 * A bill written to overturn the settlement rather than adjust it. Used to mark
 * a model-written bill as one of these, since the model has no `fringe` column
 * to set for itself.
 */
export const FRINGE_AXIS = 0.75;

/** How willing a member is to vote for something at `axis`. */
const agreement = (memberAxis, billAxis) => 1 - Math.abs(memberAxis - billAxis) / 2;

/**
 * Actions a bill takes, from a fixed list, so a politics can hold a position on
 * one regardless of how the bill is built.
 *
 * The five axes express tendencies, and a tendency is a direction with a
 * magnitude. They cannot express "always" — and a few of the positions that
 * define an ideology are exactly that. A Groyper opposes a mandate that
 * platforms police speech because that mandate is how every figure in the
 * movement was removed from the internet. There is no construction of that bill
 * they vote for, and no set of five coordinates that reliably produces "never".
 *
 * Trying to get "never" out of coordinates is what moved that ideology's
 * `liberty` three times in a day: each value was picked to make one bill come
 * out right and broke a different reflex, because it was solving for the wrong
 * kind of object.
 *
 * Every topic names an action with the direction already in it, so nothing here
 * asks a model to infer a sign — inferring a sign is what produced a police
 * accountability bill scored as an expansion of police power. Both directions
 * appear wherever a bill genuinely goes either way.
 *
 * The list is meant to stay short. A reflex is for a position that is
 * *definitional* to a politics and that the axes demonstrably get wrong; add one
 * for anything less and this becomes a lookup table with five decorative
 * coordinates attached.
 */
export const TOPIC_MEANINGS = {
  mandate_platform_moderation: "requires platforms to remove or restrict content, including hate speech and harassment",
  protect_platform_speech: "forbids platforms from removing content, or penalises them for doing so",
  expand_surveillance: "widens what agencies may collect, monitor or query",
  restrict_surveillance: "requires warrants, narrows collection, or sunsets an authority",
  protect_firearms: "removes or blocks restrictions on owning or carrying weapons",
  restrict_firearms: "adds checks, bans, registries or confiscation",
  weaken_civil_rights: "narrows who anti-discrimination law protects, or creates exemptions from it",
  strengthen_civil_rights: "widens who it protects, or stiffens enforcement",
  expand_deportation: "increases removals, detention capacity or immigration enforcement",
  fund_incarceration: "appropriates money to prisons or prison staffing, for any purpose",
  restrict_abortion: "bans, limits or adds conditions to it",
  protect_abortion: "guarantees access or blocks restrictions",
};

export const BILL_TOPICS = Object.keys(TOPIC_MEANINGS);

/**
 * Topics that are the same question pointed the other way.
 *
 * A politics that will never vote to restrict firearms will always vote to
 * protect them, and stating both is duplication that someone will eventually
 * half-do — as I did, giving a Groyper `weaken_civil_rights` and forgetting the
 * mirror, so a bill tagged the other way lost the reflex entirely. Derived
 * rather than authored, so the omission cannot recur.
 */
export const TOPIC_MIRRORS = {
  mandate_platform_moderation: "protect_platform_speech",
  expand_surveillance: "restrict_surveillance",
  restrict_firearms: "protect_firearms",
  weaken_civil_rights: "strengthen_civil_rights",
  restrict_abortion: "protect_abortion",
};

const mirrorOf = (topic) => TOPIC_MIRRORS[topic]
  || Object.keys(TOPIC_MIRRORS).find((k) => TOPIC_MIRRORS[k] === topic)
  || null;

const flip = (vote) => (vote === "yes" ? "no" : vote === "no" ? "yes" : null);

/** The most a single bill may claim to do. A bill about everything is about nothing. */
export const MAX_TOPICS = 3;

/**
 * How a politics votes on this bill when it holds a reflex about it, or null.
 *
 * Reads the same field on an ideology, a faction or a chamber member, all of
 * which carry `reflex` in the same shape. A bill naming no topic, or naming one
 * nobody has a view on, returns null and every number stays exactly what it was.
 */
export function reflexVote(voice, bill) {
  const held = voice?.reflex;
  if (!held) return null;
  for (const topic of (Array.isArray(bill?.topics) ? bill.topics : [])) {
    const stated = held[topic];
    if (stated === "yes" || stated === "no") return stated;
    // A position on the same question pointed the other way is the same position.
    const opposite = held[mirrorOf(topic)];
    if (opposite === "yes" || opposite === "no") return flip(opposite);
  }
  return null;
}

/**
 * The four issue axes, after the 8values model.
 *
 * Everything in the chamber used to be one number between −1 and 1, so the room
 * could only ever be ordered by how far out each voice sat — and monotone
 * ordering cannot express a legislature where both ends vote together against
 * both leaderships. Adding state power fixed that for one kind of fight and made
 * the next gap plain: a Groyper and a Libertarian Conservative still came out
 * neighbours, because what separates them is not money and not quite state power
 * either. It is nation against globe, and tradition against progress.
 *
 * `axis` survives all four and is not one of them. A district has a single
 * partisan lean and there is no way to get four numbers out of it, so the
 * composite stays the thing every voice has, and these are the richer
 * description used only where a bill stakes a claim on them.
 */
export const ISSUE_AXES = [
  { id: "economic", low: "equality", high: "markets",
    of: "who gets what — redistribution against growth" },
  { id: "diplomatic", low: "globe", high: "nation",
    of: "the country against the world — sovereignty against integration" },
  { id: "liberty", low: "authority", high: "liberty",
    of: "what the state may do to a person" },
  /**
   * 8values calls this axis Society. It cannot be called that here: a bill
   * already carries `society`, the block of national statistics it moves, and
   * an axis sharing that name resolves to 0 through `Number({...})` without
   * anybody noticing — which is precisely how `liberty` spent a day inert.
   */
  { id: "culture", low: "progress", high: "tradition",
    of: "the moral order — how much of it is settled" },
  /**
   * Who the law is for.
   *
   * The gap the other four left. A bill weakening racial anti-discrimination
   * protections was read as a *liberty* question — religious exemption, freedom
   * from a mandate — which describes the mechanism and says nothing about the
   * politics, so a Groyper came out against it. The number that should have
   * decided it was already in the file: `fx.civil_rights` is -32 on that
   * ideology, the most extreme value it carries, and no stance had ever read it.
   *
   * Not the same question as `culture`, and conflating them is what produced the
   * error. A Religious Left member is as traditional as a Christian Nationalist
   * on the moral order and the opposite of them on whom it is meant to protect.
   */
  { id: "pluralism", low: "hierarchy", high: "protection",
    of: "who the law is for — exclusion against universal protection" },
];

/**
 * How much of a vote the four may take between them.
 *
 * Never all of it. Below this the partisan composite always keeps a share, so a
 * seat's own politics and a caucus's anchor cannot be argued away entirely by a
 * bill that shouts loudly enough on four issues at once. Set above every
 * magnitude the pool actually uses, so no existing bill is changed by the cap
 * existing.
 */
export const ISSUE_WEIGHT_CAP = 0.9;

const valueOn = (source, id) => {
  const raw = source?.[id];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
};

/** What a bill claims, per axis, and how hard. Absent is 0 and 0 is silent. */
const claimsOf = (bill) => (typeof bill === "number"
  ? { axis: bill, claims: [] }
  : {
      axis: valueOn(bill, "axis"),
      claims: ISSUE_AXES
        .map(({ id }) => ({ id, value: valueOn(bill, id) }))
        .filter((c) => c.value !== 0),
    });

/**
 * Where a voice lands on a bill, across every axis it has a view on.
 *
 * The single place any of it is computed. The caucus card, the district card,
 * the bloc card, the player's own conviction card and the roll call all call
 * here, because the last time two of them computed the same fit separately the
 * panel and the tally disagreed about the same vote on screen.
 *
 * Sparse on purpose, and the property is load-bearing: a bill says nothing on an
 * axis by leaving it at 0, and then that axis takes none of the weight. A tax
 * cut is scored exactly as it was before any of this existed. Where a bill does
 * stake claims, they share the weight in proportion to how hard each is staked,
 * capped so the composite always keeps its say — which is what stops four loud
 * claims from adding up to more than a whole vote.
 *
 * A `null` on a voice means "has no view on this", which is not the same as a
 * neutral view and is the honest answer for a congressional district. That axis
 * simply does not reach it, and its share returns to the composite.
 */
export function stanceFit(voice, bill, consensus = consensusOf(bill)) {
  const { axis, claims } = claimsOf(bill);
  const onAxis = agreement(valueOn(voice, "axis"), axis);

  // Only the axes this voice actually holds an opinion on.
  const heard = claims.filter(({ id }) => voice?.[id] !== null && voice?.[id] !== undefined);
  if (!heard.length) return onAxis + consensus * CONSENSUS_PULL;

  /**
   * How issue-coded the bill is, taken from its strongest claim rather than the
   * sum of them.
   *
   * Summing was the obvious reading and it is wrong. Four axes at a modest 0.5
   * each add to 2.0, saturate the cap, and leave the partisan composite holding
   * a tenth of the vote — so a radicalised chamber, which coheres precisely
   * because its members share a composite, came apart on every fringe bill in
   * the pool. Taking the strongest claim says the sensible thing instead: a bill
   * is as much about its subject as its loudest note, and no louder for having
   * several.
   *
   * It also leaves the single-axis case untouched, since the maximum of one
   * number is that number.
   */
  const loudest = Math.max(...heard.map((c) => Math.abs(c.value)));
  const demand = heard.reduce((sum, c) => sum + Math.abs(c.value), 0);
  const share = Math.min(loudest, ISSUE_WEIGHT_CAP);
  let issues = 0;
  for (const c of heard) {
    issues += (Math.abs(c.value) / demand) * share * agreement(valueOn(voice, c.id), c.value);
  }
  return (1 - share) * onAxis + issues + consensus * CONSENSUS_PULL;
}

/** How much of this bill is about anything other than ordinary partisanship. */
export const issueWeight = (bill) => {
  const { claims } = claimsOf(bill);
  if (!claims.length) return 0;
  return Math.min(Math.max(...claims.map((c) => Math.abs(c.value))), ISSUE_WEIGHT_CAP);
};


/**
 * How far consensus can stretch the window.
 *
 * Tuned against target outcomes in a 46D/54R Senate rather than by feel: a
 * party-line bill at +0.5 still gets 54, the same bill marked bipartisan gets
 * 55 — because it is genuinely a partisan bill and calling it consensual does
 * not make Democrats vote for it — while a centre-right bill at +0.15 marked
 * bipartisan gets 87. The pleasing consequence is that a bill nobody wants to
 * be recorded against still only reaches 76 if it is ideologically slanted. You
 * cannot whip the whole chamber onto a right-wing bill by declaring consensus.
 */
const CONSENSUS_PULL = 0.22;

/** A bill's consensus, wherever it came from, as a number this module can use. */
export function consensusOf(bill) {
  if (typeof bill?.consensus === "number") return Math.max(0, Math.min(1, bill.consensus));
  if (typeof bill?.support === "string" && CONSENSUS[bill.support] != null) {
    return CONSENSUS[bill.support];
  }
  const authored = BILL_POOL.find((b) => b.id === bill?.id);
  if (authored && typeof authored.consensus === "number") return authored.consensus;
  return 0;
}

/** The bar a member has to clear to vote yes, once consensus is counted. */
const votesYes = (member, bill, consensus) => {
  // A reflex is a position held regardless of construction, so it decides
  // before the arithmetic runs. See BILL_TOPICS.
  const reflex = reflexVote(member, bill);
  if (reflex) return reflex === "yes";
  return stanceFit(member, bill, consensus) >= YES_THRESHOLD;
};

/** The most blocs one bill may turn. Two is a cross-cutting vote; four is a rewrite. */
export const MAX_DEFECTIONS = 2;

/**
 * A bloc voting against where its own politics would put it.
 *
 * Two axes carry the cross-cutting fights that generalise. They cannot carry
 * the ones that do not — a trade bill that splits both parties, an ag subsidy
 * that unites the two farm delegations against their leaderships, a crypto bill
 * that scrambles everybody. There is no third number for those, because what
 * they have in common is being particular, and a dimension per particular is
 * just the model's judgement with extra steps.
 *
 * So the model states it on the bill instead, once, when the bill is written.
 * Everything here stays a pure function of that frozen value: the same bill
 * gives the same roll call every time, an amended bill carries its defections
 * with it, and the bloc card and the tally cannot disagree because both read
 * this.
 */
export const defectionOn = (bill, factionId) =>
  (Array.isArray(bill?.defectors) ? bill.defectors : [])
    .find((d) => d?.faction === factionId) || null;

/**
 * The written line for one of the four stance cards, if there is one.
 *
 * The cards carried fixed strings that fired identically whatever the bill did:
 * a position computed with some care, then explained by a sentence chosen from a
 * set of two. So the model writes the sentence — told the positions the engine
 * derived, never asked for them — once, when the month's calendar is settled.
 *
 * Keyed to the stance it was written for, which is the whole safety property.
 * An explanation for the opposite vote is worse than no explanation, and a bill
 * amended in committee moves: its old sentences simply stop matching and the
 * hand-written ones take over again. Nothing has to remember to clear them.
 */
export function voiceFor(bill, who, position) {
  const line = bill?.voices?.[who];
  if (!line || typeof line.text !== "string" || !line.text) return null;
  return line.position === position ? line.text : null;
}

/**
 * Which members of a defecting bloc actually follow the whip.
 *
 * Not all of them, and that is the point — a bloc is not a switch. Discipline
 * is the share that goes, and *which* share is decided by how close each member
 * already sat to where the bloc is going: a whip converts the persuadable
 * first and the holdouts are the ones it was furthest from. That ordering is
 * deterministic, which the roll call requires, and it means a disciplined bloc
 * moves nearly whole while a loose one leaks.
 */
function whipped(roster, bill, consensus, defection) {
  const faction = factionById(defection.faction);
  if (!faction) return new Set();

  const bloc = roster.filter((m) => m.faction === defection.faction);
  const wanted = defection.position === "yes";
  // Everyone already voting the bloc's way needs no whipping.
  const holdouts = bloc.filter((m) => votesYes(m, bill, consensus) !== wanted);
  const follow = Math.round(bloc.length * faction.discipline) - (bloc.length - holdouts.length);
  if (follow <= 0) return new Set();

  const byPersuadability = [...holdouts].sort((a, b) =>
    (wanted ? -1 : 1) * (stanceFit(b, bill, consensus) - stanceFit(a, bill, consensus)));
  return new Set(byPersuadability.slice(0, follow));
}

// Above this level of agreement a member votes yes. Tuned so a bill written at
// the chamber's own median clears comfortably and one written at the far end
// of the room does not.
const YES_THRESHOLD = 0.78;

/**
 * A full roll call, member by member, on a bill at a given position.
 *
 * `tieBreak` is the Vice President's casting vote, and it only ever applies to
 * a simple majority — an override needs its two thirds on its own, and the
 * Vice President has no vote in it.
 */
/**
 * `bill` may be a bare axis number, which is what every caller passed before the
 * liberty dimension existed and what several still legitimately pass — a
 * hypothetical position rather than a bill. A number is a bill that says nothing
 * about state power, which is the correct reading of it.
 */
export function rollCall(roster, bill, { tieBreak = false, consensus = 0 } = {}) {
  /**
   * Blocs that broke ranks, resolved once for the whole chamber.
   *
   * Capped here as well as at validation, so a bill hand-written with five
   * defections in the pool cannot do what a model-written one is refused.
   */
  const turned = new Map();
  for (const d of (Array.isArray(bill?.defectors) ? bill.defectors : []).slice(0, MAX_DEFECTIONS)) {
    if (!d?.faction || (d.position !== "yes" && d.position !== "no")) continue;
    for (const m of whipped(roster, bill, consensus, d)) turned.set(m, d.position === "yes");
  }

  let yes = 0, dYes = 0, rYes = 0;
  for (const m of roster) {
    const cast = turned.has(m) ? turned.get(m) : votesYes(m, bill, consensus);
    if (!cast) continue;
    yes += 1;
    if (m.party === "Democrat") dYes += 1; else rYes += 1;
  }
  const total = roster.length;
  const threshold = Math.floor(total / 2) + 1;
  const passed = yes >= threshold || (tieBreak && yes * 2 === total);
  return {
    yes, no: total - yes, dYes, rYes, total, threshold,
    passed,
    brokenByVp: passed && yes < threshold,
    overrode: yes >= Math.ceil(total * 2 / 3),
    overrideThreshold: Math.ceil(total * 2 / 3),
  };
}

/** Where a chamber's centre of gravity actually sits. */
export function chamberMedian(roster) {
  if (!roster.length) return 0;
  const axes = roster.map((m) => m.axis).sort((a, b) => a - b);
  return axes[Math.floor(axes.length / 2)];
}

const rosterFor = (state) => buildCongress(state, STATES);

/**
 * What Congress sends up this month. Bills are drawn near the House's own
 * median — the chamber writes what the chamber believes — and only those that
 * clear both chambers reach the president's desk.
 */
export function originateBills(state, roster = rosterFor(state)) {
  if (state.congressDissolved) return [];

  const r = seeded(`${state.rosterSeed}|bills|${state.month}`);
  // Roughly half of months bring something; a busy Congress brings two.
  const count = r.chance(0.42) ? 0 : r.chance(0.72) ? 1 : 2;
  if (!count) return [];

  const median = chamberMedian(roster.house);
  const radical = state.scenario?.radicals === true;
  const seen = new Set(state.billHistory || []);

  // Congress can only send what it can actually pass, so the roll call is the
  // filter — not a guess about what the chamber "would" write. Anything that
  // clears both chambers is a candidate; the chamber simply prefers the ones
  // closest to its own centre of gravity.
  const candidates = BILL_POOL
    .filter((b) => (radical || !b.fringe) && !seen.has(b.id))
    .map((bill) => ({
      bill,
      house: rollCall(roster.house, bill),
      senate: rollCall(roster.senate, bill, { tieBreak: vpSupports(state, bill.axis) }),
    }))
    .filter((c) => c.house.passed && c.senate.passed)
    .map((c) => ({ ...c, weight: 1 / (0.12 + Math.abs(c.bill.axis - median)) }));
  if (!candidates.length) return [];

  const out = [];
  for (let i = 0; i < count && candidates.length; i++) {
    const picked = r.weighted(candidates, candidates.map((c) => c.weight));
    candidates.splice(candidates.indexOf(picked), 1);
    const { bill, house, senate } = picked;

    const sponsor = pickSponsor(roster.house, bill.axis, r);
    out.push(scheduledBill(bill, {
      arrivedMonth: state.month,
      sponsor: sponsor ? `${sponsor.title} ${sponsor.name} (${sponsor.party[0]}-${sponsor.state})` : "a bipartisan group",
      sponsorIdeology: sponsor?.ideology || "",
      house, senate,
    }));
  }
  return out;
}

/** The member closest to the bill's politics gets their name on it. */
function pickSponsor(roster, billAxis, r) {
  const near = [...roster]
    .sort((a, b) => Math.abs(a.axis - billAxis) - Math.abs(b.axis - billAxis))
    .slice(0, 12);
  return near.length ? near[Math.floor(r.next() * near.length)] : null;
}

/** Apply a bill's consequences to a state that is about to become law. */
function enact(next, bill) {
  const fx = billById(bill.id)?.fx || {};
  next.approval = clamp(round1(next.approval + (fx.approval || 0)));

  for (const [key, value] of Object.entries(fx)) {
    if (key === "approval" || key === "economy") continue;
    if (next.stakeholders[key] != null) {
      next.stakeholders[key] = clamp(Math.round(next.stakeholders[key] + value));
    }
  }
  if (fx.economy && next.scenario.economy !== false) {
    const e = fx.economy;
    next.economy.gdpGrowth = clamp(round1(next.economy.gdpGrowth + (e.gdpGrowth || 0)), -7, 7);
    next.economy.unemployment = clamp(round1(next.economy.unemployment + (e.unemployment || 0)), 1.5, 25);
    next.economy.inflation = clamp(round1(next.economy.inflation + (e.inflation || 0)), -3, 40);
    next.economy.debt = round1(next.economy.debt + (e.debt || 0));
  }
  const society = billById(bill.id)?.society;
  if (society && next.society) {
    for (const [k, v] of Object.entries(society)) {
      if (next.society[k] != null) next.society[k] = round1(next.society[k] + v);
    }
  }
}

/**
 * Sign it or veto it.
 *
 * Signing a bill your own side hates costs you with them. Vetoing invites an
 * override, and being overridden is worse than either — it is a public
 * demonstration that Congress does not need you.
 */
export function actOnBill(state, billId, action) {
  const bill = (state.bills || []).find((b) => b.id === billId);
  if (!bill) return { rejected: true, note: "No such bill is on your desk." };
  if (action !== "sign" && action !== "veto") return { rejected: true, note: "Sign it or veto it." };

  const next = structuredClone(state);
  next.bills = (next.bills || []).filter((b) => b.id !== billId);
  next.billHistory = [...(next.billHistory || []), billId];
  next.billLog = next.billLog || [];

  if (action === "sign") {
    enact(next, bill);
    next.billLog.unshift({ month: state.month, id: bill.id, title: bill.title, outcome: "signed" });
    return {
      state: next, outcome: "signed",
      note: `You signed the ${bill.title}. It is law.`,
    };
  }

  // A veto. Congress gets its say.
  const roster = rosterFor(state);
  const house = rollCall(roster.house, bill);
  // The casting vote cannot save a veto: an override is a two-thirds question.
  const senate = rollCall(roster.senate, bill, { tieBreak: vpSupports(state, bill.axis) });
  const overridden = house.overrode && senate.overrode;

  if (overridden) {
    enact(next, bill);
    next.approval = clamp(round1(next.approval - 3.5));
    next.stability = clamp(next.stability - 6);
    next.billLog.unshift({ month: state.month, id: bill.id, title: bill.title, outcome: "overridden" });
    return {
      state: next, outcome: "overridden", house, senate,
      note: `Your veto of the ${bill.title} was overridden — ${house.yes}–${house.no} in the House and ` +
        `${senate.yes}–${senate.no} in the Senate. It is law anyway, and everyone watched it happen.`,
    };
  }

  // The veto held. Cheaper, but the sponsors remember.
  next.approval = clamp(round1(next.approval - 0.8));
  next.billLog.unshift({ month: state.month, id: bill.id, title: bill.title, outcome: "vetoed" });
  return {
    state: next, outcome: "vetoed", house, senate,
    note: `You vetoed the ${bill.title} and the override failed — ${house.yes} of ${house.overrideThreshold} ` +
      `needed in the House. It is dead.`,
  };
}

/** Bills left unsigned for too long: Congress moves on and you look passive. */
export function ageBills(next) {
  const bills = next.bills || [];
  if (!bills.length) return [];
  const expired = bills.filter((b) => next.month - b.arrivedMonth >= 3);
  if (!expired.length) return [];

  next.bills = bills.filter((b) => next.month - b.arrivedMonth < 3);
  next.approval = clamp(round1(next.approval - 0.6 * expired.length));
  next.billHistory = [...(next.billHistory || []), ...expired.map((b) => b.id)];
  return expired;
}

/** A line for the AI's context block. */
export function billsSummary(state) {
  const bills = state.bills || [];
  if (!bills.length) return "";
  return `Bills awaiting your signature: ${bills.map((b) =>
    `${b.title} (passed ${b.house.yes}–${b.house.no} House, ${b.senate.yes}–${b.senate.no} Senate)`).join("; ")}.`;
}
