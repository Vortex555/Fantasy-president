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
 *
 * Two numbers place a politics, not one.
 *
 * `axis` is the economic left–right question — who gets what. `liberty` is the
 * separate one it kept being confused with: what the state may do to a person.
 * +1 is "the state may not", −1 is "the state must", and they genuinely do not
 * correlate. A Civil Libertarian at −0.4 and a Constitutionalist at +0.7 sit at
 * opposite ends of the first axis and next to each other on the second, which is
 * why they end up cosponsoring surveillance bills in real chambers and why the
 * engine could not previously produce one.
 *
 * Several of the `sub` lines below have been describing this dimension in prose
 * since they were written — "−Surveillance state", "−Federal power", "−Law &
 * order", "emergency powers". The numbers now say what the words already did.
 */

export const IDEOLOGIES = {
  Democrat: [
    { value: "Liberal Mainstream", axis: -0.35, liberty: -0.1, sub: "Balanced — the party as it is",
      fx: {},
      trait: { strength: "Leadership trusts you with anything, because you have never once been a problem.", limit: "Nobody has ever knocked a door for you. There is no movement behind your name.", files: "budget" } },
    { value: "Progressive Firebrand", axis: -0.7, liberty: 0.4, sub: "+Labour, +Civil rights, −Wall St, −Swing voters",
      fx: { labor: 10, civil_rights: 10, greens: 6, wall_street: -12, approval: -2 } },
    { value: "Blue Dog Moderate", axis: -0.12, liberty: -0.4, sub: "+Swing voters, +Gun owners, −Base energy",
      fx: { gun_owners: 10, big_business: 5, approval: 3, civil_rights: -6, greens: -5 } },
    { value: "Third Way", axis: -0.2, liberty: -0.4, sub: "+Wall St, +Institutions, −Labour",
      fx: { wall_street: 12, big_business: 10, stability: 5, labor: -10 } },
    { value: "Labour Democrat", axis: -0.45, liberty: -0.1, sub: "+Labour hard, culturally moderate",
      fx: { labor: 16, gun_owners: 4, greens: -6, wall_street: -8 } },
    { value: "Technocratic Liberal", axis: -0.25, liberty: -0.5, sub: "+Institutions, +Business, −Mass appeal",
      fx: { stability: 8, big_business: 8, approval: -3 } },
    { value: "Environmental Left", axis: -0.6, liberty: -0.2, sub: "+Environmentalists hard, −Fossil-fuel labour",
      fx: { greens: 18, civil_rights: 5, labor: -6, big_business: -8 } },
    { value: "Social Democrat", axis: -0.6, liberty: 0, sub: "+Labour, +Civil rights, −Wall St",
      fx: { labor: 12, civil_rights: 8, greens: 5, wall_street: -14 } },
    { value: "Anti-Monopoly Populist", axis: -0.55, liberty: -0.2, sub: "+Labour, −Big business hard",
      fx: { labor: 12, big_business: -18, wall_street: -10, approval: 2 } },
    { value: "Civil Libertarian", axis: -0.4, liberty: 0.9, sub: "+Civil rights, −Pentagon, −Law & order",
      fx: { civil_rights: 14, pentagon: -10, gun_owners: 4 } },
    { value: "Religious Left", axis: -0.35, liberty: 0.1, sub: "+Faith, +Civil rights, unusual coalition",
      fx: { faith: 12, civil_rights: 10, labor: 5, big_business: -5 } },
    { value: "Abundance Democrat", axis: -0.25, liberty: 0.3, sub: "+Business, +Housing, −Environmental veto",
      fx: { big_business: 10, labor: 4, greens: -8, stability: 4 } },
    { value: "New Left / Identitarian", axis: -0.75, liberty: 0.2, sub: "+Civil rights hard, −Faith, −Swing voters",
      fx: { civil_rights: 18, greens: 6, faith: -12, approval: -3 } },

    // --- Fringe & radical ---
    { value: "Democratic Socialist", axis: -0.85, liberty: 0.2, sub: "+Labour hard, −Wall St, −Big business", fringe: true,
      fx: { labor: 20, civil_rights: 10, wall_street: -22, big_business: -18, stability: -5 } },
    { value: "Eco-Socialist", axis: -0.9, liberty: -0.3, sub: "+Environmentalists, +Labour, −Industry", fringe: true,
      fx: { greens: 24, labor: 10, big_business: -20, wall_street: -15, stability: -6 } },
    { value: "Syndicalist", axis: -0.95, liberty: 0.3, sub: "Power to the unions, −Everything else", fringe: true,
      fx: { labor: 26, wall_street: -26, big_business: -22, stability: -12, approval: -4 } },
    { value: "Degrowth Advocate", axis: -0.85, liberty: -0.5, sub: "+Environmentalists, −The entire economy", fringe: true,
      fx: { greens: 26, labor: -12, big_business: -24, wall_street: -20, stability: -10, approval: -6 } },

    // --- Added: the benches were thin in places, and a caucus needs members ---
    { value: "Rural Democrat", axis: -0.28, liberty: 0.2, sub: "+Farm country, +Gun owners, −Greens",
      fx: { labor: 8, gun_owners: 12, greens: -12, big_business: 4 },
      trait: { strength: "Farm-state colleagues will hear you out whoever they caucus with.", limit: "Environmentalists will never fund you.", files: "agriculture" } },
    { value: "Municipal Progressive", axis: -0.55, liberty: 0.2, sub: "+Cities, +Labour, −Rural seats",
      fx: { labor: 12, civil_rights: 10, greens: 8, faith: -6 },
      trait: { strength: "City machines turn out for you.", limit: "You cannot win a rural seat.", files: "housing" } },
    { value: "Consumer Advocate", axis: -0.5, liberty: -0.2, sub: "+Civil rights, −Big business hard",
      fx: { civil_rights: 14, labor: 8, big_business: -18, wall_street: -12 },
      trait: { strength: "Antitrust bills clear your committee at half the usual resistance.", limit: "Business money never comes.", files: "antitrust" } },
    { value: "Veterans Democrat", axis: -0.3, liberty: -0.4, sub: "+Pentagon, +Labour, culturally centrist",
      fx: { pentagon: 14, labor: 8, civil_rights: -4 },
      trait: { strength: "Defence bills are yours to shape whichever party holds the gavel.", limit: "The party's left never trusts you.", files: "veterans" } },
    { value: "Public Health Democrat", axis: -0.48, liberty: -0.4, sub: "+Health institutions, −Faith",
      fx: { civil_rights: 8, labor: 6, faith: -10, big_business: -6 },
      trait: { strength: "In an epidemic your bills bypass committee entirely.", limit: "Nothing you file interests anyone in a calm year.", files: "health" } },
    { value: "Reform Liberal", axis: -0.38, liberty: 0.2, sub: "+Institutions, anti-corruption",
      fx: { stability: 10, civil_rights: 8, wall_street: -8 },
      trait: { strength: "Ethics investigations you launch actually land.", limit: "You will never hold leadership; they know what you are.", files: "ethics" } },

    // --- Added: the contemporary radical left -------------------------------
    { value: "Abolitionist Left", axis: -0.88, liberty: 0.8, sub: "+Civil rights hard, −Police, −Stability", fringe: true,
      fx: { civil_rights: 30, labor: 8, gun_owners: -20, faith: -12, stability: -16, approval: -6 },
      trait: { strength: "Movement organisations mobilise for you at a scale money cannot buy.", limit: "No law-and-order bill will ever carry your name.", files: "ethics" } },
    { value: "Tenant Organiser", axis: -0.82, liberty: 0, sub: "+Renters, +Labour, −Property", fringe: true,
      fx: { labor: 22, civil_rights: 14, big_business: -22, wall_street: -20, stability: -10 },
      trait: { strength: "You can turn a housing fight into a national one overnight.", limit: "Homeowners in your own seat organise against you.", files: "housing" } },
    { value: "Marxist–Leninist", axis: -0.95, liberty: -0.85, sub: "+Labour hard, −Everything else, −Stability hard", fringe: true,
      fx: { labor: 28, civil_rights: 6, wall_street: -32, big_business: -30, pentagon: -14, stability: -24, approval: -10 },
      trait: { strength: "A cadre that does what it is told, which nobody else in the chamber has.", limit: "Every institution in the country treats you as an enemy.", files: "industry" } },
    { value: "Anti-War Left", axis: -0.78, liberty: 0.7, sub: "−Pentagon hard, +Civil rights", fringe: true,
      fx: { pentagon: -30, civil_rights: 18, greens: 8, big_business: -12, stability: -8, approval: -4 },
      trait: { strength: "You can force a war-powers vote the leadership has spent months avoiding.", limit: "Any deployment anywhere destroys you at home.", files: "warpowers" } },
  ],

  Republican: [
    { value: "Traditional Conservative", axis: 0.45, liberty: -0.1, sub: "Balanced — the party as it is",
      fx: {},
      trait: { strength: "You are the party's default, and the default gets the gavel when the room cannot agree.", limit: "The base suspects you of believing nothing very much, and it is not entirely wrong.", files: "budget" } },
    { value: "National Populist", axis: 0.6, liberty: 0.2, sub: "+Base energy, −Establishment, −Moderates",
      fx: { gun_owners: 12, faith: 8, labor: 6, big_business: -10, stability: -6, approval: 2 } },
    { value: "Moderate Republican", axis: 0.18, liberty: -0.2, sub: "+Swing voters, +Institutions, −Base",
      fx: { stability: 8, big_business: 6, approval: 4, faith: -8, gun_owners: -8 } },
    { value: "Libertarian Conservative", axis: 0.5, liberty: 0.9, sub: "+Gun owners, +Business, −Religious right",
      fx: { gun_owners: 16, big_business: 10, wall_street: 6, faith: -10 } },
    { value: "Religious Right", axis: 0.65, liberty: -0.4, sub: "+Faith hard, −Big tech, −Secular voters",
      fx: { faith: 20, gun_owners: 6, big_business: -6, civil_rights: -10 } },
    { value: "Neoconservative", axis: 0.5, liberty: -0.7, sub: "+Pentagon, +Wall St, −Populists",
      fx: { pentagon: 18, wall_street: 12, big_business: 8, labor: -8, approval: -2 } },
    { value: "Business Republican", axis: 0.4, liberty: 0, sub: "+Wall St, +Chamber, −Labour",
      fx: { wall_street: 18, big_business: 16, labor: -12 } },
    { value: "Fusionist", axis: 0.5, liberty: 0, sub: "The old three-legged stool: markets, faith, defence",
      fx: { faith: 8, wall_street: 8, pentagon: 8, gun_owners: 6, stability: 4 } },
    { value: "Paleoconservative", axis: 0.6, liberty: 0.5, sub: "+Base, −Pentagon, −Trade",
      fx: { faith: 10, gun_owners: 10, labor: 6, pentagon: -14, big_business: -10 } },
    { value: "National Conservative", axis: 0.55, liberty: -0.2, sub: "Industrial policy plus social traditionalism",
      fx: { labor: 10, faith: 12, gun_owners: 8, wall_street: -12, big_business: -6 } },
    { value: "Rockefeller Republican", axis: 0.1, liberty: -0.2, sub: "+Institutions, +Civil rights, −Base",
      fx: { stability: 10, civil_rights: 10, big_business: 8, faith: -10, gun_owners: -12, approval: 2 } },
    { value: "Constitutionalist", axis: 0.7, liberty: 0.85, sub: "+Gun owners hard, −Federal government",
      fx: { gun_owners: 20, faith: 8, stability: -10, civil_rights: -6 } },
    { value: "Law & Order Conservative", axis: 0.6, liberty: -0.9, sub: "+Police, +Pentagon, −Civil rights",
      fx: { gun_owners: 12, pentagon: 12, stability: 6, civil_rights: -16 } },
    { value: "Techno-Libertarian", axis: 0.35, liberty: 0.7, sub: "+Big tech, +Markets, −Regulators, −Faith",
      fx: { big_business: 18, wall_street: 10, faith: -12, labor: -10, stability: -4 } },

    // --- Fringe & radical ---
    { value: "Christian Nationalist", axis: 0.9, liberty: -0.6, sub: "+Faith hard, −Secularists, −Civil rights", fringe: true,
      fx: { faith: 26, gun_owners: 10, civil_rights: -24, big_business: -8, stability: -12 } },
    { value: "Nativist", axis: 0.85, liberty: -0.4, sub: "+Base energy, −Business, −Civil rights", fringe: true,
      fx: { gun_owners: 14, faith: 10, civil_rights: -26, big_business: -16, stability: -12, approval: -3 } },
    { value: "Neoreactionary", axis: 0.9, liberty: -0.9, sub: "Rule by the competent few. −Almost everyone", fringe: true,
      fx: { wall_street: 10, big_business: 8, civil_rights: -28, labor: -18, stability: -18, approval: -8 } },
    { value: "Caesarist", axis: 0.85, liberty: -0.95, sub: "+Pentagon hard, −The republic", fringe: true,
      fx: { pentagon: 26, gun_owners: 10, civil_rights: -26, stability: -20, approval: -6 } },
    { value: "Anarcho-Capitalist", axis: 0.8, liberty: 1, sub: "Abolish the state. −Everything the state holds up", fringe: true,
      fx: { big_business: 20, wall_street: 16, gun_owners: 16, labor: -20, pentagon: -20, stability: -22 } },

    // --- Added ---------------------------------------------------------------
    { value: "Suburban Republican", axis: 0.22, liberty: -0.2, sub: "+Business, +Swing seats, −Base energy",
      fx: { big_business: 12, wall_street: 8, faith: -8, approval: 4 },
      trait: { strength: "You hold seats no other Republican can.", limit: "The base primaries you every cycle.", files: "education" } },
    { value: "Agrarian Conservative", axis: 0.42, liberty: 0.2, sub: "+Farm country, +Faith, −Wall St",
      fx: { faith: 10, gun_owners: 10, wall_street: -8, big_business: -4 },
      trait: { strength: "Farm-state colleagues will hear you out whoever they caucus with.", limit: "Urban money never comes.", files: "agriculture" } },
    { value: "Defense Hawk", axis: 0.5, liberty: -0.7, sub: "+Pentagon hard, −Deficit hawks",
      fx: { pentagon: 22, big_business: 8, greens: -8 },
      trait: { strength: "Procurement bills clear committee at half the usual resistance.", limit: "You can never vote for a cut, so you can never balance anything.", files: "defence" } },
    { value: "Energy Republican", axis: 0.48, liberty: 0.2, sub: "+Fossil labour, +Business, −Greens hard",
      fx: { big_business: 14, labor: 6, greens: -22 },
      trait: { strength: "Energy states fund you regardless of your seat.", limit: "Environmentalists organise against you personally.", files: "energy" } },
    { value: "Reform Conservative", axis: 0.3, liberty: 0, sub: "+Working families, −Wall St orthodoxy",
      fx: { faith: 8, labor: 6, wall_street: -10, approval: 3 },
      trait: { strength: "Your bills draw Democratic cosponsors nobody expected.", limit: "The donor class treats you as a traitor.", files: "family" } },
    { value: "Institutionalist", axis: 0.35, liberty: -0.5, sub: "+Stability hard, −Populists",
      fx: { stability: 16, big_business: 6, gun_owners: -8 },
      trait: { strength: "You can hold a chamber together in a crisis when nobody else can.", limit: "You will never excite anybody.", files: "procedure" } },

    // --- Added: the contemporary radical right ------------------------------
    /**
     * The America First / groyper current, which is not the same thing as a
     * generically very-online nationalist and should not be modelled as one.
     *
     * What separates it is the direction of fire. Its founding activity was not
     * campaigning against the left but a sustained campaign against mainstream
     * conservatism — organised heckling of established conservative figures at
     * their own events, on the grounds that they were insufficiently radical.
     * It is an entryist insurgency aimed at capturing the institutions of its own
     * side, and it is explicitly white-nationalist and antisemitic, which is what
     * makes those institutions treat it as an infestation rather than a wing.
     *
     * So the mechanics are the mirror image of every other radical here. The
     * others are extreme versions of their party; this one is at war with its
     * party, and the engine says so: its bloc standing is enormous, its standing
     * with leadership is close to unrecoverable, and it is the only ideology in
     * the game that cannot hold office in its own caucus at all.
     */
    { value: "Groyper", axis: 0.95, liberty: 0.5, sub: "+Young online right hard, −Party establishment hard, −Civil rights hard", fringe: true,
      wrecker: true,
      fx: { gun_owners: 14, faith: 8, civil_rights: -32, big_business: -24, wall_street: -22, pentagon: -14, stability: -20, approval: -12 },
      trait: {
        strength: "You can end a mainstream conservative's career from a phone. The swarm arrives within the hour, it costs nothing, and it does not disperse.",
        limit: "Your own party treats you as an infestation. No committee, no gavel, no donor, no leadership post — not ever, however long you serve.",
        files: "procedure",
      } },
    { value: "Post-Liberal Integralist", axis: 0.88, liberty: -0.8, sub: "+Faith hard, +State power, −Markets", fringe: true,
      fx: { faith: 28, stability: -14, civil_rights: -24, wall_street: -18, big_business: -14, approval: -5 },
      trait: { strength: "You can build a coalition of religious conservatives and economic populists nobody else can.", limit: "The business wing of your own party funds your primary opponent.", files: "family" } },
    { value: "Sovereigntist", axis: 0.86, liberty: 0.9, sub: "+Gun owners hard, −Federal power, −Institutions", fringe: true,
      fx: { gun_owners: 26, faith: 10, stability: -22, civil_rights: -16, pentagon: -10, approval: -4 },
      trait: { strength: "Rural militia country treats you as its only voice in Washington.", limit: "You cannot pass anything that funds a federal agency.", files: "landuse" } },
    { value: "Techno-Monarchist", axis: 0.84, liberty: -0.9, sub: "+Tech capital, −Democracy itself", fringe: true,
      fx: { big_business: 22, wall_street: 18, civil_rights: -26, labor: -22, stability: -24, approval: -10 },
      trait: { strength: "A handful of very rich people will fund anything you put your name to.", limit: "You are asking an elected chamber to vote for its own abolition.", files: "procedure" } },
  ],

  Independent: [
    { value: "Radical Centrist", axis: 0.0, liberty: -0.2, sub: "Balanced — a plague on both their houses",
      fx: { stability: 4, approval: 2 },
      trait: { strength: "Both sides will negotiate with you, which in a hung chamber is the only power there is.", limit: "Neither side will die for you. When it is close you are on your own.", files: "procedure" } },
    { value: "Reform Populist", axis: -0.05, liberty: 0.2, sub: "+Reform base, +Labour, −Wall St, −Establishment",
      fx: { labor: 10, approval: 4, wall_street: -14, big_business: -10, stability: -4 } },
    { value: "Libertarian", axis: 0.4, liberty: 0.95, sub: "+Free markets, +Gun owners, −Regulators, −Welfare state",
      fx: { gun_owners: 18, big_business: 14, wall_street: 10, labor: -14, pentagon: -8 } },
    { value: "Green", axis: -0.65, liberty: 0, sub: "+Environmentalists hard, −Fossil fuels, −Heavy industry",
      fx: { greens: 24, civil_rights: 8, big_business: -16, labor: -6 } },
    { value: "Social Democrat", axis: -0.6, liberty: 0, sub: "+Labour, +Civil rights, −Wall St",
      fx: { labor: 14, civil_rights: 10, greens: 6, wall_street: -16 } },
    { value: "Technocrat", axis: 0.05, liberty: -0.5, sub: "+Institutions, +Business, −Mass appeal",
      fx: { stability: 14, big_business: 10, wall_street: 6, approval: -6 } },
    { value: "Georgist", axis: -0.3, liberty: 0.1, sub: "Tax the land, untax the work. −Landlords, −Wall St",
      fx: { labor: 14, big_business: 6, wall_street: -18, stability: -4 } },
    { value: "Distributist", axis: 0.15, liberty: 0.2, sub: "+Faith, +Small business, −Big business, −Wall St",
      fx: { faith: 14, labor: 8, big_business: -18, wall_street: -14 } },
    { value: "Agrarian Populist", axis: 0.2, liberty: 0.3, sub: "+Rural labour, +Gun owners, −Wall St",
      fx: { labor: 12, gun_owners: 12, faith: 8, wall_street: -20, big_business: -10 } },
    { value: "Civic Nationalist", axis: 0.4, liberty: -0.3, sub: "+Pentagon, +Stability, −Globalists",
      fx: { pentagon: 14, gun_owners: 8, stability: 6, big_business: -8 } },
    { value: "Cosmopolitan Globalist", axis: -0.15, liberty: -0.4, sub: "+Business, +Institutions, −Populists",
      fx: { big_business: 16, wall_street: 12, stability: 8, labor: -12, gun_owners: -10, approval: -4 } },
    { value: "Digital Rights / Pirate", axis: -0.3, liberty: 0.9, sub: "+Civil rights, −Big tech, −Surveillance state",
      fx: { civil_rights: 18, big_business: -12, pentagon: -12, stability: -4 } },

    // --- Fringe & radical ---
    { value: "Communist", axis: -0.95, liberty: -0.85, sub: "+Labour hard, −Wall St, −Big business, −Stability", fringe: true,
      fx: { labor: 28, civil_rights: 12, wall_street: -32, big_business: -28, stability: -20, approval: -6 } },
    { value: "Anarcho-Syndicalist", axis: -0.95, liberty: 0.9, sub: "No state, no bosses. −Almost every institution", fringe: true,
      fx: { labor: 30, civil_rights: 14, wall_street: -30, big_business: -26, pentagon: -22, stability: -26 } },
    { value: "Christian Nationalist", axis: 0.9, liberty: -0.6, sub: "+Faith hard, −Secularists, −Civil rights", fringe: true,
      fx: { faith: 26, gun_owners: 10, civil_rights: -24, stability: -12 } },
    { value: "Theocrat", axis: 0.95, liberty: -0.9, sub: "Scripture as statute. −Everyone outside the church", fringe: true,
      fx: { faith: 32, civil_rights: -30, big_business: -14, greens: -8, stability: -20, approval: -8 } },
    { value: "Monarchist", axis: 0.8, liberty: -0.8, sub: "Restore the crown. −The entire constitutional order", fringe: true,
      fx: { stability: -24, civil_rights: -20, faith: 12, pentagon: 8, approval: -10 } },
    { value: "Accelerationist", axis: 0.5, liberty: 0.4, sub: "Break it faster. −Stability, −Everything downstream", fringe: true,
      fx: { big_business: 10, stability: -30, labor: -14, civil_rights: -12, approval: -8 } },
    { value: "Transhumanist", axis: 0.1, liberty: 0.3, sub: "+Big tech hard, −Faith, −Labour",
      fringe: true,
      fx: { big_business: 22, wall_street: 10, faith: -22, labor: -12, stability: -8 } },
    { value: "Primitivist", axis: -0.7, liberty: 0, sub: "Unwind the industrial age. −The economy, entirely", fringe: true,
      fx: { greens: 30, big_business: -30, wall_street: -26, labor: -20, stability: -22, approval: -12 } },
    { value: "Military Junta", axis: 0.8, liberty: -1, sub: "+Pentagon hard, −The republic", fringe: true,
      fx: { pentagon: 30, gun_owners: 10, civil_rights: -30, labor: -12, stability: -18, approval: -8 } },
    { value: "Longtermist", axis: 0.1, liberty: -0.4, sub: "Govern for the century. −Everyone alive now", fringe: true,
      fx: { greens: 14, big_business: 10, stability: 6, labor: -14, approval: -10 } },

    // --- Added ---------------------------------------------------------------
    { value: "Municipalist", axis: -0.5, liberty: 0.4, sub: "+Cities, +Labour, anti-federal",
      fx: { labor: 10, civil_rights: 8, stability: -6 },
      trait: { strength: "Mayors and city halls act on your bills before Washington does.", limit: "No statewide seat will ever elect you.", files: "housing" } },
    { value: "Syncretic Populist", axis: 0.05, liberty: 0, sub: "+Labour, +Faith, −Institutions",
      fx: { labor: 12, faith: 10, wall_street: -14, stability: -8 },
      trait: { strength: "You can build a majority nobody else in the chamber can assemble.", limit: "Neither caucus will give you a gavel.", files: "trade" } },
    { value: "Pacifist", axis: -0.4, liberty: 0.5, sub: "−Pentagon hard, +Civil rights",
      fx: { pentagon: -24, civil_rights: 12, greens: 6 },
      trait: { strength: "You can force a war-powers vote nobody wants to take.", limit: "Any deployment destroys your standing at home.", files: "warpowers" } },
    { value: "Frontier Libertarian", axis: 0.6, liberty: 0.9, sub: "+Gun owners, −Federal power",
      fx: { gun_owners: 22, stability: -10, big_business: 6 },
      trait: { strength: "Rural western seats are yours for the asking.", limit: "You cannot pass anything that spends money.", files: "landuse" } },
    { value: "Corporatist", axis: 0.25, liberty: -0.5, sub: "+Business, +Labour, −Consumers",
      fx: { big_business: 16, labor: 10, wall_street: 8, civil_rights: -8 },
      trait: { strength: "Industry and unions will sit at the same table for you.", limit: "Reformers of both parties treat you as the problem.", files: "industry" } },
    { value: "Technocratic Centrist", axis: 0.0, liberty: -0.5, sub: "+Institutions hard, −Everyone else",
      fx: { stability: 14, big_business: 6, labor: -6, approval: -4 },
      trait: { strength: "Your numbers are trusted even by people who hate you.", limit: "You have no base at all.", files: "budget" } },
    { value: "Left Nationalist", axis: -0.65, liberty: -0.2, sub: "+Labour hard, +Tariffs, −Globalists",
      fx: { labor: 20, big_business: -12, wall_street: -16, greens: -6 },
      trait: { strength: "Industrial seats will follow you across party lines.", limit: "Cosmopolitan donors will not touch you.", files: "trade" } },
    { value: "Communitarian", axis: -0.15, liberty: -0.3, sub: "+Faith, +Labour, −Individualists",
      fx: { faith: 14, labor: 8, civil_rights: -6, stability: 6 },
      trait: { strength: "Faith institutions and unions both open doors for you.", limit: "Civil-liberties groups campaign against you.", files: "family" } },

    // --- Added: radicals who belong to neither party -------------------------
    { value: "Ethnonationalist", axis: 0.95, liberty: -0.6, sub: "+Nativists hard, −Civil rights hard, −Stability hard", fringe: true,
      fx: { gun_owners: 18, faith: 10, civil_rights: -34, big_business: -20, wall_street: -16, stability: -26, approval: -12 },
      trait: { strength: "A committed base that no scandal disperses.", limit: "Every other bloc in the chamber organises against you personally.", files: "procedure" } },
    { value: "Climate Emergency", axis: -0.9, liberty: -0.7, sub: "+Greens hard, −Industry, emergency powers", fringe: true,
      fx: { greens: 32, civil_rights: 6, big_business: -28, wall_street: -22, labor: -14, stability: -18, approval: -8 },
      trait: { strength: "A disaster is your mandate, and there is always another disaster.", limit: "In a calm year nobody will take your calls.", files: "energy" } },
    { value: "Populist Nationalist", axis: 0.7, liberty: 0, sub: "+Labour, +Gun owners, −Institutions, −Trade", fringe: true,
      fx: { labor: 14, gun_owners: 18, faith: 12, wall_street: -24, big_business: -18, stability: -16, approval: -2 },
      trait: { strength: "You take votes off both parties in seats neither can hold.", limit: "Neither caucus will ever give you a gavel.", files: "trade" } },
    { value: "Crypto-Anarchist", axis: 0.55, liberty: 0.95, sub: "+Tech capital, −State capacity hard", fringe: true,
      fx: { big_business: 16, wall_street: 14, stability: -28, labor: -18, civil_rights: 6, pentagon: -16, approval: -8 },
      trait: { strength: "Money reaches you through channels no ethics committee can trace.", limit: "You cannot fund anything, because you do not believe in funding things.", files: "budget" } },
    { value: "Localist Secessionist", axis: 0.4, liberty: 0.8, sub: "−Federal power hard, +Local control", fringe: true,
      fx: { gun_owners: 14, faith: 8, stability: -30, civil_rights: -10, pentagon: -14, approval: -6 },
      trait: { strength: "Whole state legislatures will pass your model bills.", limit: "You are in Congress to dismantle the thing you were elected to.", files: "procedure" } },
    { value: "Technocratic Authoritarian", axis: 0.3, liberty: -0.95, sub: "+Institutions hard, −Democracy", fringe: true,
      fx: { stability: -10, big_business: 16, pentagon: 12, civil_rights: -28, labor: -14, approval: -12 },
      trait: { strength: "Your bills are drafted better than anybody else's and everyone knows it.", limit: "You cannot win a competitive election and you know that too.", files: "procedure" } },
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
    // Where this politics stands on state power. Carried onto the scenario the
    // same way the axis is, because every stance in the chamber now reads both.
    ideologyLiberty: found?.liberty ?? 0,
    ideologyIntensity: found?.fringe ? 1.7 : 1,
  };
}
