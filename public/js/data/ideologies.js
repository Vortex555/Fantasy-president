"use strict";

/**
 * Ideologies.
 *
 * Each party gets a mainstream bench and a fringe one. `fringe: true` moves an
 * entry below the divider on the setup screen — these are the positions that
 * win you a devoted faction and cost you the room.
 *
 * `fx` is applied when the game is seeded, exactly like the character profile:
 * stakeholder ids move that bloc's starting support, and `approval` /
 * `stability` move the president's own opening numbers. The `sub` line is the
 * plain-English version of the same numbers, so nothing here is decorative.
 */

export const IDEOLOGIES = {
  Democrat: [
    { value: "Liberal Mainstream", axis: -0.35, sub: "Balanced — the party as it is",
      fx: {} },
    { value: "Progressive Firebrand", axis: -0.7, sub: "+Labour, +Civil rights, −Wall St, −Swing voters",
      fx: { labor: 10, civil_rights: 10, greens: 6, wall_street: -12, approval: -2 } },
    { value: "Blue Dog Moderate", axis: -0.12, sub: "+Swing voters, +Gun owners, −Base energy",
      fx: { gun_owners: 10, big_business: 5, approval: 3, civil_rights: -6, greens: -5 } },
    { value: "Third Way", axis: -0.2, sub: "+Wall St, +Institutions, −Labour",
      fx: { wall_street: 12, big_business: 10, stability: 5, labor: -10 } },
    { value: "Labour Democrat", axis: -0.45, sub: "+Labour hard, culturally moderate",
      fx: { labor: 16, gun_owners: 4, greens: -6, wall_street: -8 } },
    { value: "Technocratic Liberal", axis: -0.25, sub: "+Institutions, +Business, −Mass appeal",
      fx: { stability: 8, big_business: 8, approval: -3 } },
    { value: "Environmental Left", axis: -0.6, sub: "+Environmentalists hard, −Fossil-fuel labour",
      fx: { greens: 18, civil_rights: 5, labor: -6, big_business: -8 } },
    { value: "Social Democrat", axis: -0.6, sub: "+Labour, +Civil rights, −Wall St",
      fx: { labor: 12, civil_rights: 8, greens: 5, wall_street: -14 } },
    { value: "Anti-Monopoly Populist", axis: -0.55, sub: "+Labour, −Big business hard",
      fx: { labor: 12, big_business: -18, wall_street: -10, approval: 2 } },
    { value: "Civil Libertarian", axis: -0.4, sub: "+Civil rights, −Pentagon, −Law & order",
      fx: { civil_rights: 14, pentagon: -10, gun_owners: 4 } },
    { value: "Religious Left", axis: -0.35, sub: "+Faith, +Civil rights, unusual coalition",
      fx: { faith: 12, civil_rights: 10, labor: 5, big_business: -5 } },
    { value: "Abundance Democrat", axis: -0.25, sub: "+Business, +Housing, −Environmental veto",
      fx: { big_business: 10, labor: 4, greens: -8, stability: 4 } },
    { value: "New Left / Identitarian", axis: -0.75, sub: "+Civil rights hard, −Faith, −Swing voters",
      fx: { civil_rights: 18, greens: 6, faith: -12, approval: -3 } },

    // --- Fringe & radical ---
    { value: "Democratic Socialist", axis: -0.85, sub: "+Labour hard, −Wall St, −Big business", fringe: true,
      fx: { labor: 20, civil_rights: 10, wall_street: -22, big_business: -18, stability: -5 } },
    { value: "Eco-Socialist", axis: -0.9, sub: "+Environmentalists, +Labour, −Industry", fringe: true,
      fx: { greens: 24, labor: 10, big_business: -20, wall_street: -15, stability: -6 } },
    { value: "Syndicalist", axis: -0.95, sub: "Power to the unions, −Everything else", fringe: true,
      fx: { labor: 26, wall_street: -26, big_business: -22, stability: -12, approval: -4 } },
    { value: "Degrowth Advocate", axis: -0.85, sub: "+Environmentalists, −The entire economy", fringe: true,
      fx: { greens: 26, labor: -12, big_business: -24, wall_street: -20, stability: -10, approval: -6 } },
  ],

  Republican: [
    { value: "Traditional Conservative", axis: 0.45, sub: "Balanced — the party as it is",
      fx: {} },
    { value: "National Populist", axis: 0.6, sub: "+Base energy, −Establishment, −Moderates",
      fx: { gun_owners: 12, faith: 8, labor: 6, big_business: -10, stability: -6, approval: 2 } },
    { value: "Moderate Republican", axis: 0.18, sub: "+Swing voters, +Institutions, −Base",
      fx: { stability: 8, big_business: 6, approval: 4, faith: -8, gun_owners: -8 } },
    { value: "Libertarian Conservative", axis: 0.5, sub: "+Gun owners, +Business, −Religious right",
      fx: { gun_owners: 16, big_business: 10, wall_street: 6, faith: -10 } },
    { value: "Religious Right", axis: 0.65, sub: "+Faith hard, −Big tech, −Secular voters",
      fx: { faith: 20, gun_owners: 6, big_business: -6, civil_rights: -10 } },
    { value: "Neoconservative", axis: 0.5, sub: "+Pentagon, +Wall St, −Populists",
      fx: { pentagon: 18, wall_street: 12, big_business: 8, labor: -8, approval: -2 } },
    { value: "Business Republican", axis: 0.4, sub: "+Wall St, +Chamber, −Labour",
      fx: { wall_street: 18, big_business: 16, labor: -12 } },
    { value: "Fusionist", axis: 0.5, sub: "The old three-legged stool: markets, faith, defence",
      fx: { faith: 8, wall_street: 8, pentagon: 8, gun_owners: 6, stability: 4 } },
    { value: "Paleoconservative", axis: 0.6, sub: "+Base, −Pentagon, −Trade",
      fx: { faith: 10, gun_owners: 10, labor: 6, pentagon: -14, big_business: -10 } },
    { value: "National Conservative", axis: 0.55, sub: "Industrial policy plus social traditionalism",
      fx: { labor: 10, faith: 12, gun_owners: 8, wall_street: -12, big_business: -6 } },
    { value: "Rockefeller Republican", axis: 0.1, sub: "+Institutions, +Civil rights, −Base",
      fx: { stability: 10, civil_rights: 10, big_business: 8, faith: -10, gun_owners: -12, approval: 2 } },
    { value: "Constitutionalist", axis: 0.7, sub: "+Gun owners hard, −Federal government",
      fx: { gun_owners: 20, faith: 8, stability: -10, civil_rights: -6 } },
    { value: "Law & Order Conservative", axis: 0.6, sub: "+Police, +Pentagon, −Civil rights",
      fx: { gun_owners: 12, pentagon: 12, stability: 6, civil_rights: -16 } },
    { value: "Techno-Libertarian", axis: 0.35, sub: "+Big tech, +Markets, −Regulators, −Faith",
      fx: { big_business: 18, wall_street: 10, faith: -12, labor: -10, stability: -4 } },

    // --- Fringe & radical ---
    { value: "Christian Nationalist", axis: 0.9, sub: "+Faith hard, −Secularists, −Civil rights", fringe: true,
      fx: { faith: 26, gun_owners: 10, civil_rights: -24, big_business: -8, stability: -12 } },
    { value: "Nativist", axis: 0.85, sub: "+Base energy, −Business, −Civil rights", fringe: true,
      fx: { gun_owners: 14, faith: 10, civil_rights: -26, big_business: -16, stability: -12, approval: -3 } },
    { value: "Neoreactionary", axis: 0.9, sub: "Rule by the competent few. −Almost everyone", fringe: true,
      fx: { wall_street: 10, big_business: 8, civil_rights: -28, labor: -18, stability: -18, approval: -8 } },
    { value: "Caesarist", axis: 0.85, sub: "+Pentagon hard, −The republic", fringe: true,
      fx: { pentagon: 26, gun_owners: 10, civil_rights: -26, stability: -20, approval: -6 } },
    { value: "Anarcho-Capitalist", axis: 0.8, sub: "Abolish the state. −Everything the state holds up", fringe: true,
      fx: { big_business: 20, wall_street: 16, gun_owners: 16, labor: -20, pentagon: -20, stability: -22 } },
  ],

  Independent: [
    { value: "Radical Centrist", axis: 0.0, sub: "Balanced — a plague on both their houses",
      fx: { stability: 4, approval: 2 } },
    { value: "Reform Populist", axis: -0.05, sub: "+Reform base, +Labour, −Wall St, −Establishment",
      fx: { labor: 10, approval: 4, wall_street: -14, big_business: -10, stability: -4 } },
    { value: "Libertarian", axis: 0.4, sub: "+Free markets, +Gun owners, −Regulators, −Welfare state",
      fx: { gun_owners: 18, big_business: 14, wall_street: 10, labor: -14, pentagon: -8 } },
    { value: "Green", axis: -0.65, sub: "+Environmentalists hard, −Fossil fuels, −Heavy industry",
      fx: { greens: 24, civil_rights: 8, big_business: -16, labor: -6 } },
    { value: "Social Democrat", axis: -0.6, sub: "+Labour, +Civil rights, −Wall St",
      fx: { labor: 14, civil_rights: 10, greens: 6, wall_street: -16 } },
    { value: "Technocrat", axis: 0.05, sub: "+Institutions, +Business, −Mass appeal",
      fx: { stability: 14, big_business: 10, wall_street: 6, approval: -6 } },
    { value: "Georgist", axis: -0.3, sub: "Tax the land, untax the work. −Landlords, −Wall St",
      fx: { labor: 14, big_business: 6, wall_street: -18, stability: -4 } },
    { value: "Distributist", axis: 0.15, sub: "+Faith, +Small business, −Big business, −Wall St",
      fx: { faith: 14, labor: 8, big_business: -18, wall_street: -14 } },
    { value: "Agrarian Populist", axis: 0.2, sub: "+Rural labour, +Gun owners, −Wall St",
      fx: { labor: 12, gun_owners: 12, faith: 8, wall_street: -20, big_business: -10 } },
    { value: "Civic Nationalist", axis: 0.4, sub: "+Pentagon, +Stability, −Globalists",
      fx: { pentagon: 14, gun_owners: 8, stability: 6, big_business: -8 } },
    { value: "Cosmopolitan Globalist", axis: -0.15, sub: "+Business, +Institutions, −Populists",
      fx: { big_business: 16, wall_street: 12, stability: 8, labor: -12, gun_owners: -10, approval: -4 } },
    { value: "Digital Rights / Pirate", axis: -0.3, sub: "+Civil rights, −Big tech, −Surveillance state",
      fx: { civil_rights: 18, big_business: -12, pentagon: -12, stability: -4 } },

    // --- Fringe & radical ---
    { value: "Communist", axis: -0.95, sub: "+Labour hard, −Wall St, −Big business, −Stability", fringe: true,
      fx: { labor: 28, civil_rights: 12, wall_street: -32, big_business: -28, stability: -20, approval: -6 } },
    { value: "Anarcho-Syndicalist", axis: -0.95, sub: "No state, no bosses. −Almost every institution", fringe: true,
      fx: { labor: 30, civil_rights: 14, wall_street: -30, big_business: -26, pentagon: -22, stability: -26 } },
    { value: "Christian Nationalist", axis: 0.9, sub: "+Faith hard, −Secularists, −Civil rights", fringe: true,
      fx: { faith: 26, gun_owners: 10, civil_rights: -24, stability: -12 } },
    { value: "Theocrat", axis: 0.95, sub: "Scripture as statute. −Everyone outside the church", fringe: true,
      fx: { faith: 32, civil_rights: -30, big_business: -14, greens: -8, stability: -20, approval: -8 } },
    { value: "Monarchist", axis: 0.8, sub: "Restore the crown. −The entire constitutional order", fringe: true,
      fx: { stability: -24, civil_rights: -20, faith: 12, pentagon: 8, approval: -10 } },
    { value: "Accelerationist", axis: 0.5, sub: "Break it faster. −Stability, −Everything downstream", fringe: true,
      fx: { big_business: 10, stability: -30, labor: -14, civil_rights: -12, approval: -8 } },
    { value: "Transhumanist", axis: 0.1, sub: "+Big tech hard, −Faith, −Labour",
      fringe: true,
      fx: { big_business: 22, wall_street: 10, faith: -22, labor: -12, stability: -8 } },
    { value: "Primitivist", axis: -0.7, sub: "Unwind the industrial age. −The economy, entirely", fringe: true,
      fx: { greens: 30, big_business: -30, wall_street: -26, labor: -20, stability: -22, approval: -12 } },
    { value: "Military Junta", axis: 0.8, sub: "+Pentagon hard, −The republic", fringe: true,
      fx: { pentagon: 30, gun_owners: 10, civil_rights: -30, labor: -12, stability: -18, approval: -8 } },
    { value: "Longtermist", axis: 0.1, sub: "Govern for the century. −Everyone alive now", fringe: true,
      fx: { greens: 14, big_business: 10, stability: 6, labor: -14, approval: -10 } },
  ],
};

export const ideologiesFor = (party) => IDEOLOGIES[party] || IDEOLOGIES.Independent;

export const mainstreamIdeologies = (party) => ideologiesFor(party).filter((i) => !i.fringe);
export const fringeIdeologies = (party) => ideologiesFor(party).filter((i) => i.fringe);

export const findIdeology = (party, value) =>
  ideologiesFor(party).find((i) => i.value === value) || null;

/** The starting-bloc effects of an ideology, in the same shape as the profile. */
export const ideologyEffects = (party, value) => ({ ...(findIdeology(party, value)?.fx || {}) });

/**
 * Where an ideology sits on the spectrum, and how sharply it divides the room.
 * A fringe position polarises: more of the panel loves you, more loathes you,
 * and far fewer of them shrug.
 */
export function ideologyPosition(party, value) {
  const found = findIdeology(party, value);
  return {
    ideologyAxis: found?.axis ?? 0,
    ideologyIntensity: found?.fringe ? 1.7 : 1,
  };
}
