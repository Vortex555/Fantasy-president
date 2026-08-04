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
 * Five numbers place a politics, and only one of them is left–right.
 *
 * `axis` is the ordinary partisan spectrum — the same one a district's lean is
 * converted onto and the same one the two party anchors sit on. It is not an
 * economic scale, and a note here once said it was; that reading makes a Groyper
 * at +0.95 look like it contradicts its own anti-corporate bloc effects, when a
 * right-wing movement that takes no corporate money is an ordinary thing.
 *
 * The other four are the 8values axes, and they are what make an ideology more
 * than a point on a line:
 *
 *   economic    −1 equality   … +1 markets      who gets what
 *   diplomatic  −1 globe      … +1 nation       sovereignty against integration
 *   liberty     −1 authority  … +1 liberty      what the state may do to a person
 *   culture     −1 progress   … +1 tradition    how settled the moral order is
 *   pluralism   −1 hierarchy  … +1 protection   who the law is for
 *                                              (8values calls it Society; a bill
 *                                               already uses that word for its stats)
 *
 * `diplomatic` is sovereignty, not militarism — a neoconservative is *globe*
 * despite the hawkishness, and a paleoconservative is *nation* despite wanting
 * the troops home. That split is the one those two actually hate each other
 * over, and one spectrum could not draw it at all.
 *
 * Together they do the thing a single axis never could: a Groyper and a
 * Libertarian Conservative stop being neighbours. They differ on all four.
 */

export const IDEOLOGIES = {
  Democrat: [
    { value: "Liberal Mainstream", axis: -0.35, economic: -0.35, diplomatic: -0.3, liberty: -0.1, culture: -0.3, pluralism: 0.45, sub: "Balanced — the party as it is",
      fx: {},
      trait: { strength: "Leadership trusts you with anything, because you have never once been a problem.", limit: "Nobody has ever knocked a door for you. There is no movement behind your name.", files: "budget" } },
    { value: "Progressive Firebrand", axis: -0.7, economic: -0.75, diplomatic: -0.4, liberty: 0.4, culture: -0.7, pluralism: 0.7, sub: "+Labour, +Civil rights, −Wall St, −Swing voters",
      fx: { labor: 10, civil_rights: 10, greens: 6, wall_street: -12, approval: -2 } },
    { value: "Blue Dog Moderate", axis: -0.12, economic: -0.1, diplomatic: 0.3, liberty: -0.4, culture: 0.3, pluralism: 0.1, sub: "+Swing voters, +Gun owners, −Base energy",
      fx: { gun_owners: 10, big_business: 5, approval: 3, civil_rights: -6, greens: -5 } },
    { value: "Third Way", axis: -0.2, economic: 0.3, diplomatic: -0.5, liberty: -0.4, culture: -0.2, pluralism: 0.3, sub: "+Wall St, +Institutions, −Labour",
      fx: { wall_street: 12, big_business: 10, stability: 5, labor: -10 } },
    { value: "Labour Democrat", axis: -0.45, economic: -0.7, diplomatic: 0.2, liberty: -0.1, culture: 0.1, pluralism: 0.25, sub: "+Labour hard, culturally moderate",
      fx: { labor: 16, gun_owners: 4, greens: -6, wall_street: -8 } },
    { value: "Technocratic Liberal", axis: -0.25, economic: -0.1, diplomatic: -0.5, liberty: -0.5, culture: -0.5, pluralism: 0.35, sub: "+Institutions, +Business, −Mass appeal",
      fx: { stability: 8, big_business: 8, approval: -3 } },
    { value: "Environmental Left", axis: -0.6, economic: -0.6, diplomatic: -0.5, liberty: -0.2, culture: -0.6, pluralism: 0.5, sub: "+Environmentalists hard, −Fossil-fuel labour",
      fx: { greens: 18, civil_rights: 5, labor: -6, big_business: -8 } },
    { value: "Social Democrat", axis: -0.6, economic: -0.75, diplomatic: -0.3, liberty: 0, culture: -0.3, pluralism: 0.6, sub: "+Labour, +Civil rights, −Wall St",
      fx: { labor: 12, civil_rights: 8, greens: 5, wall_street: -14 } },
    { value: "Anti-Monopoly Populist", axis: -0.55, economic: -0.6, diplomatic: 0.1, liberty: -0.2, culture: -0.2, pluralism: 0.35, sub: "+Labour, −Big business hard",
      fx: { labor: 12, big_business: -18, wall_street: -10, approval: 2 } },
    { value: "Civil Libertarian", axis: -0.4, economic: -0.2, diplomatic: -0.3, liberty: 0.9, culture: -0.5, pluralism: 0.75, sub: "+Civil rights, −Pentagon, −Law & order", reflex: { restrict_surveillance: "yes", expand_surveillance: "no", strengthen_civil_rights: "yes" },
      fx: { civil_rights: 14, pentagon: -10, gun_owners: 4 } },
    { value: "Religious Left", axis: -0.35, economic: -0.6, diplomatic: -0.2, liberty: 0.1, culture: 0.4, pluralism: 0.55, sub: "+Faith, +Civil rights, unusual coalition",
      fx: { faith: 12, civil_rights: 10, labor: 5, big_business: -5 } },
    { value: "Abundance Democrat", axis: -0.25, economic: 0.2, diplomatic: -0.3, liberty: 0.3, culture: -0.4, pluralism: 0.35, sub: "+Business, +Housing, −Environmental veto",
      fx: { big_business: 10, labor: 4, greens: -8, stability: 4 } },
    { value: "New Left / Identitarian", axis: -0.75, economic: -0.6, diplomatic: -0.5, liberty: 0.2, culture: -0.9, pluralism: 0.85, sub: "+Civil rights hard, −Faith, −Swing voters",
      fx: { civil_rights: 18, greens: 6, faith: -12, approval: -3 } },

    // --- Fringe & radical ---
    { value: "Democratic Socialist", axis: -0.85, economic: -0.9, diplomatic: -0.3, liberty: 0.2, culture: -0.4, pluralism: 0.7, sub: "+Labour hard, −Wall St, −Big business", fringe: true,
      fx: { labor: 20, civil_rights: 10, wall_street: -22, big_business: -18, stability: -5 } },
    { value: "Eco-Socialist", axis: -0.9, economic: -0.9, diplomatic: -0.4, liberty: -0.3, culture: -0.6, pluralism: 0.6, sub: "+Environmentalists, +Labour, −Industry", fringe: true,
      fx: { greens: 24, labor: 10, big_business: -20, wall_street: -15, stability: -6 } },
    { value: "Syndicalist", axis: -0.95, economic: -0.95, diplomatic: 0, liberty: 0.3, culture: -0.3, pluralism: 0.45, sub: "Power to the unions, −Everything else", fringe: true,
      fx: { labor: 26, wall_street: -26, big_business: -22, stability: -12, approval: -4 } },
    { value: "Degrowth Advocate", axis: -0.85, economic: -0.8, diplomatic: -0.4, liberty: -0.5, culture: -0.4, pluralism: 0.35, sub: "+Environmentalists, −The entire economy", fringe: true,
      fx: { greens: 26, labor: -12, big_business: -24, wall_street: -20, stability: -10, approval: -6 } },

    // --- Added: the benches were thin in places, and a caucus needs members ---
    { value: "Rural Democrat", axis: -0.28, economic: -0.3, diplomatic: 0.35, liberty: 0.2, culture: 0.35, pluralism: 0.1, sub: "+Farm country, +Gun owners, −Greens",
      fx: { labor: 8, gun_owners: 12, greens: -12, big_business: 4 },
      trait: { strength: "Farm-state colleagues will hear you out whoever they caucus with.", limit: "Environmentalists will never fund you.", files: "agriculture" } },
    { value: "Municipal Progressive", axis: -0.55, economic: -0.65, diplomatic: -0.3, liberty: 0.2, culture: -0.7, pluralism: 0.7, sub: "+Cities, +Labour, −Rural seats",
      fx: { labor: 12, civil_rights: 10, greens: 8, faith: -6 },
      trait: { strength: "City machines turn out for you.", limit: "You cannot win a rural seat.", files: "housing" } },
    { value: "Consumer Advocate", axis: -0.5, economic: -0.55, diplomatic: -0.1, liberty: -0.2, culture: -0.2, pluralism: 0.5, sub: "+Civil rights, −Big business hard",
      fx: { civil_rights: 14, labor: 8, big_business: -18, wall_street: -12 },
      trait: { strength: "Antitrust bills clear your committee at half the usual resistance.", limit: "Business money never comes.", files: "antitrust" } },
    { value: "Veterans Democrat", axis: -0.3, economic: -0.25, diplomatic: 0.5, liberty: -0.4, culture: 0.2, pluralism: 0.1, sub: "+Pentagon, +Labour, culturally centrist",
      fx: { pentagon: 14, labor: 8, civil_rights: -4 },
      trait: { strength: "Defence bills are yours to shape whichever party holds the gavel.", limit: "The party's left never trusts you.", files: "veterans" } },
    { value: "Public Health Democrat", axis: -0.48, economic: -0.5, diplomatic: -0.3, liberty: -0.4, culture: -0.5, pluralism: 0.45, sub: "+Health institutions, −Faith",
      fx: { civil_rights: 8, labor: 6, faith: -10, big_business: -6 },
      trait: { strength: "In an epidemic your bills bypass committee entirely.", limit: "Nothing you file interests anyone in a calm year.", files: "health" } },
    { value: "Reform Liberal", axis: -0.38, economic: -0.3, diplomatic: -0.2, liberty: 0.2, culture: -0.3, pluralism: 0.55, sub: "+Institutions, anti-corruption",
      fx: { stability: 10, civil_rights: 8, wall_street: -8 },
      trait: { strength: "Ethics investigations you launch actually land.", limit: "You will never hold leadership; they know what you are.", files: "ethics" } },

    // --- Added: the contemporary radical left -------------------------------
    { value: "Abolitionist Left", axis: -0.88, economic: -0.7, diplomatic: -0.4, liberty: 0.8, culture: -0.9, pluralism: 0.9, sub: "+Civil rights hard, −Police, −Stability", reflex: { fund_incarceration: "no", strengthen_civil_rights: "yes" }, fringe: true,
      fx: { civil_rights: 30, labor: 8, gun_owners: -20, faith: -12, stability: -16, approval: -6 },
      trait: { strength: "Movement organisations mobilise for you at a scale money cannot buy.", limit: "No law-and-order bill will ever carry your name.", files: "ethics" } },
    { value: "Tenant Organiser", axis: -0.82, economic: -0.85, diplomatic: -0.2, liberty: 0, culture: -0.5, pluralism: 0.65, sub: "+Renters, +Labour, −Property", fringe: true,
      fx: { labor: 22, civil_rights: 14, big_business: -22, wall_street: -20, stability: -10 },
      trait: { strength: "You can turn a housing fight into a national one overnight.", limit: "Homeowners in your own seat organise against you.", files: "housing" } },
    { value: "Marxist–Leninist", axis: -0.95, economic: -1, diplomatic: 0.1, liberty: -0.85, culture: -0.3, pluralism: 0.15, sub: "+Labour hard, −Everything else, −Stability hard", fringe: true,
      fx: { labor: 28, civil_rights: 6, wall_street: -32, big_business: -30, pentagon: -14, stability: -24, approval: -10 },
      trait: { strength: "A cadre that does what it is told, which nobody else in the chamber has.", limit: "Every institution in the country treats you as an enemy.", files: "industry" } },
    { value: "Anti-War Left", axis: -0.78, economic: -0.6, diplomatic: -0.8, liberty: 0.7, culture: -0.5, pluralism: 0.7, sub: "−Pentagon hard, +Civil rights", fringe: true,
      fx: { pentagon: -30, civil_rights: 18, greens: 8, big_business: -12, stability: -8, approval: -4 },
      trait: { strength: "You can force a war-powers vote the leadership has spent months avoiding.", limit: "Any deployment anywhere destroys you at home.", files: "warpowers" } },
  ],

  Republican: [
    { value: "Traditional Conservative", axis: 0.45, economic: 0.5, diplomatic: 0.3, liberty: -0.1, culture: 0.6, pluralism: -0.1, sub: "Balanced — the party as it is",
      fx: {},
      trait: { strength: "You are the party's default, and the default gets the gavel when the room cannot agree.", limit: "The base suspects you of believing nothing very much, and it is not entirely wrong.", files: "budget" } },
    { value: "National Populist", axis: 0.6, economic: 0.1, diplomatic: 0.85, liberty: 0.2, culture: 0.6, pluralism: -0.5, sub: "+Base energy, −Establishment, −Moderates",
      fx: { gun_owners: 12, faith: 8, labor: 6, big_business: -10, stability: -6, approval: 2 } },
    { value: "Moderate Republican", axis: 0.18, economic: 0.35, diplomatic: -0.1, liberty: -0.2, culture: 0.15, pluralism: 0.15, sub: "+Swing voters, +Institutions, −Base",
      fx: { stability: 8, big_business: 6, approval: 4, faith: -8, gun_owners: -8 } },
    { value: "Libertarian Conservative", axis: 0.5, economic: 0.9, diplomatic: -0.2, liberty: 0.9, culture: 0.1, pluralism: 0.1, sub: "+Gun owners, +Business, −Religious right", reflex: { protect_firearms: "yes", restrict_surveillance: "yes", mandate_platform_moderation: "no" },
      fx: { gun_owners: 16, big_business: 10, wall_street: 6, faith: -10 } },
    { value: "Religious Right", axis: 0.65, economic: 0.35, diplomatic: 0.4, liberty: -0.4, culture: 0.82, pluralism: -0.35, sub: "+Faith hard, −Big tech, −Secular voters",
      fx: { faith: 20, gun_owners: 6, big_business: -6, civil_rights: -10 } },
    { value: "Neoconservative", axis: 0.5, economic: 0.6, diplomatic: -0.55, liberty: -0.7, culture: 0.4, pluralism: -0.1, sub: "+Pentagon, +Wall St, −Populists",
      fx: { pentagon: 18, wall_street: 12, big_business: 8, labor: -8, approval: -2 } },
    { value: "Business Republican", axis: 0.4, economic: 0.9, diplomatic: -0.4, liberty: 0, culture: 0.15, pluralism: 0, sub: "+Wall St, +Chamber, −Labour",
      fx: { wall_street: 18, big_business: 16, labor: -12 } },
    { value: "Fusionist", axis: 0.5, economic: 0.7, diplomatic: 0.2, liberty: 0, culture: 0.6, pluralism: -0.1, sub: "The old three-legged stool: markets, faith, defence",
      fx: { faith: 8, wall_street: 8, pentagon: 8, gun_owners: 6, stability: 4 } },
    { value: "Paleoconservative", axis: 0.6, economic: 0.25, diplomatic: 0.8, liberty: 0.5, culture: 0.75, pluralism: -0.5, sub: "+Base, −Pentagon, −Trade",
      fx: { faith: 10, gun_owners: 10, labor: 6, pentagon: -14, big_business: -10 } },
    { value: "National Conservative", axis: 0.55, economic: 0.05, diplomatic: 0.8, liberty: -0.2, culture: 0.8, pluralism: -0.45, sub: "Industrial policy plus social traditionalism",
      fx: { labor: 10, faith: 12, gun_owners: 8, wall_street: -12, big_business: -6 } },
    { value: "Rockefeller Republican", axis: 0.1, economic: 0.4, diplomatic: -0.3, liberty: -0.2, culture: -0.2, pluralism: 0.4, sub: "+Institutions, +Civil rights, −Base",
      fx: { stability: 10, civil_rights: 10, big_business: 8, faith: -10, gun_owners: -12, approval: 2 } },
    { value: "Constitutionalist", axis: 0.7, economic: 0.7, diplomatic: 0.5, liberty: 0.85, culture: 0.5, pluralism: -0.15, sub: "+Gun owners hard, −Federal government", reflex: { protect_firearms: "yes", restrict_surveillance: "yes", mandate_platform_moderation: "no" },
      fx: { gun_owners: 20, faith: 8, stability: -10, civil_rights: -6 } },
    { value: "Law & Order Conservative", axis: 0.6, economic: 0.4, diplomatic: 0.5, liberty: -0.9, culture: 0.7, pluralism: -0.5, sub: "+Police, +Pentagon, −Civil rights", reflex: { fund_incarceration: "yes", expand_surveillance: "yes" },
      fx: { gun_owners: 12, pentagon: 12, stability: 6, civil_rights: -16 } },
    { value: "Techno-Libertarian", axis: 0.35, economic: 0.85, diplomatic: -0.5, liberty: 0.7, culture: -0.4, pluralism: 0.1, sub: "+Big tech, +Markets, −Regulators, −Faith",
      fx: { big_business: 18, wall_street: 10, faith: -12, labor: -10, stability: -4 } },

    // --- Fringe & radical ---
    { value: "Christian Nationalist", axis: 0.9, economic: 0.15, diplomatic: 0.8, liberty: -0.6, culture: 1, pluralism: -0.75, sub: "+Faith hard, −Secularists, −Civil rights", reflex: { restrict_abortion: "yes", protect_firearms: "yes", weaken_civil_rights: "yes" }, fringe: true,
      fx: { faith: 26, gun_owners: 10, civil_rights: -24, big_business: -8, stability: -12 } },
    { value: "Nativist", axis: 0.85, economic: 0.1, diplomatic: 0.9, liberty: -0.4, culture: 0.7, pluralism: -0.85, sub: "+Base energy, −Business, −Civil rights", reflex: { expand_deportation: "yes" }, fringe: true,
      fx: { gun_owners: 14, faith: 10, civil_rights: -26, big_business: -16, stability: -12, approval: -3 } },
    { value: "Neoreactionary", axis: 0.9, economic: 0.5, diplomatic: 0.4, liberty: -0.9, culture: 0.85, pluralism: -0.85, sub: "Rule by the competent few. −Almost everyone", fringe: true,
      fx: { wall_street: 10, big_business: 8, civil_rights: -28, labor: -18, stability: -18, approval: -8 } },
    { value: "Caesarist", axis: 0.85, economic: 0.2, diplomatic: 0.85, liberty: -0.95, culture: 0.6, pluralism: -0.75, sub: "+Pentagon hard, −The republic", fringe: true,
      fx: { pentagon: 26, gun_owners: 10, civil_rights: -26, stability: -20, approval: -6 } },
    { value: "Anarcho-Capitalist", axis: 0.8, economic: 1, diplomatic: -0.1, liberty: 1, culture: 0, pluralism: 0, sub: "Abolish the state. −Everything the state holds up", fringe: true,
      fx: { big_business: 20, wall_street: 16, gun_owners: 16, labor: -20, pentagon: -20, stability: -22 } },

    // --- Added ---------------------------------------------------------------
    { value: "Suburban Republican", axis: 0.22, economic: 0.55, diplomatic: -0.2, liberty: -0.2, culture: 0, pluralism: 0.15, sub: "+Business, +Swing seats, −Base energy",
      fx: { big_business: 12, wall_street: 8, faith: -8, approval: 4 },
      trait: { strength: "You hold seats no other Republican can.", limit: "The base primaries you every cycle.", files: "education" } },
    { value: "Agrarian Conservative", axis: 0.42, economic: 0.3, diplomatic: 0.5, liberty: 0.2, culture: 0.7, pluralism: -0.15, sub: "+Farm country, +Faith, −Wall St",
      fx: { faith: 10, gun_owners: 10, wall_street: -8, big_business: -4 },
      trait: { strength: "Farm-state colleagues will hear you out whoever they caucus with.", limit: "Urban money never comes.", files: "agriculture" } },
    { value: "Defense Hawk", axis: 0.5, economic: 0.5, diplomatic: -0.15, liberty: -0.7, culture: 0.4, pluralism: -0.1, sub: "+Pentagon hard, −Deficit hawks",
      fx: { pentagon: 22, big_business: 8, greens: -8 },
      trait: { strength: "Procurement bills clear committee at half the usual resistance.", limit: "You can never vote for a cut, so you can never balance anything.", files: "defence" } },
    { value: "Energy Republican", axis: 0.48, economic: 0.7, diplomatic: 0.4, liberty: 0.2, culture: 0.4, pluralism: -0.05, sub: "+Fossil labour, +Business, −Greens hard",
      fx: { big_business: 14, labor: 6, greens: -22 },
      trait: { strength: "Energy states fund you regardless of your seat.", limit: "Environmentalists organise against you personally.", files: "energy" } },
    { value: "Reform Conservative", axis: 0.3, economic: 0.35, diplomatic: 0.2, liberty: 0, culture: 0.4, pluralism: 0.1, sub: "+Working families, −Wall St orthodoxy",
      fx: { faith: 8, labor: 6, wall_street: -10, approval: 3 },
      trait: { strength: "Your bills draw Democratic cosponsors nobody expected.", limit: "The donor class treats you as a traitor.", files: "family" } },
    { value: "Institutionalist", axis: 0.35, economic: 0.5, diplomatic: -0.2, liberty: -0.5, culture: 0.3, pluralism: 0.15, sub: "+Stability hard, −Populists",
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
     * their own events, on the grounds that they were insufficiently radical. It
     * is an entryist insurgency aimed at capturing the institutions of its own
     * side, and it is explicitly white-nationalist and antisemitic.
     *
     * It used to carry `wrecker: true`, which closed the committee ladder to it
     * outright — no room, no gavel, no promotion, however long it served. That
     * was an honest statement of what the movement is and a poor one of what a
     * game is: the ideology had no verbs left but its vote, and every other
     * screen in the mode was addressed to somebody who could not use it. The
     * ladder is open to it on the same terms as everybody else until the mode
     * has something for an insurgent to *do*.
     */
    /**
     * Its anti-statism is a grievance, not a principle, so the number is
     * negative.
     *
     * This sat at +0.5 and put the movement in the same quadrant as the
     * Libertarian Conservative and the Constitutionalist — which reads it as
     * libertarianism with the dial turned up, and that is close to the opposite
     * of what it is. The groyper war was fought *against* the libertarian-
     * fusionist wing of its own side.
     *
     * It is loudly against the federal agencies that investigate it and the
     * platforms that ban it, and those are the two places anyone hears it talk
     * about freedom. Everywhere else it wants the state doing more, not less:
     * mass deportation, policing of its enemies, the enforcement of a moral
     * order in public life. Weigh those against each other across all the bills
     * that touch state power and the balance is authoritarian.
     *
     * Moved three times, and the reason is worth recording because it was not
     * this number's fault.
     *
     * It went -0.25, then +0.2, then -0.75, each time to make one bill on one
     * screen come out right. The last move followed a correct observation — that
     * the movement wants blasphemy and obscenity prosecuted, and is louder about
     * it than the Christian Nationalists are — and drew the wrong conclusion from
     * it. That support is expressed by `culture`, which is +0.9 here. Charging it
     * on this axis as well made the ideology *support* a mandate that platforms
     * police speech, which is the single thing it exists to fight: content
     * moderation is the mechanism by which every one of its figures was
     * deplatformed.
     *
     * So the ambiguity was never in the ideology, it was in how bills get
     * classified. A bill about what the moral order permits is a `culture` bill;
     * `liberty` is for who may be silenced, searched or detained. Coded that way,
     * `culture` carries the obscenity vote on its own and this axis is free to be
     * what the politics actually is — against the state's power over speech,
     * because that power keeps landing on them.
     *
     * What no scalar holds is that they want it landing on everyone else. That
     * is relational rather than positional and no axis can express it, including
     * the one someone will eventually propose for it: a "who is coercion pointed
     * at" axis puts obscenity law and platform bans on the *same* side, and the
     * ideology wants opposite votes on them. `defectors` is the tool for those.
     */
    { value: "Groyper", axis: 0.95, economic: 0.1, diplomatic: 0.9, liberty: 0.2, culture: 0.9, pluralism: -0.95, sub: "+Young online right hard, −Party establishment hard, −Civil rights hard", reflex: { mandate_platform_moderation: "no", forbid_platform_removals: "yes", protect_firearms: "yes", weaken_civil_rights: "yes", expand_deportation: "yes" }, fringe: true,
      fx: { gun_owners: 14, faith: 8, civil_rights: -32, big_business: -24, wall_street: -22, pentagon: -14, stability: -20, approval: -12 },
      trait: {
        strength: "You can end a mainstream conservative's career from a phone. The swarm arrives within the hour, it costs nothing, and it does not disperse.",
        limit: "Leadership will hand you a gavel and never once defend you holding it. Every donor call starts with an apology.",
        files: "procedure",
      } },
    { value: "Post-Liberal Integralist", axis: 0.88, economic: 0, diplomatic: 0.6, liberty: -0.8, culture: 0.95, pluralism: -0.7, sub: "+Faith hard, +State power, −Markets", fringe: true,
      fx: { faith: 28, stability: -14, civil_rights: -24, wall_street: -18, big_business: -14, approval: -5 },
      trait: { strength: "You can build a coalition of religious conservatives and economic populists nobody else can.", limit: "The business wing of your own party funds your primary opponent.", files: "family" } },
    { value: "Sovereigntist", axis: 0.86, economic: 0.6, diplomatic: 0.9, liberty: 0.9, culture: 0.6, pluralism: -0.45, sub: "+Gun owners hard, −Federal power, −Institutions", fringe: true,
      fx: { gun_owners: 26, faith: 10, stability: -22, civil_rights: -16, pentagon: -10, approval: -4 },
      trait: { strength: "Rural militia country treats you as its only voice in Washington.", limit: "You cannot pass anything that funds a federal agency.", files: "landuse" } },
    { value: "Techno-Monarchist", axis: 0.84, economic: 0.8, diplomatic: 0.2, liberty: -0.9, culture: 0.3, pluralism: -0.8, sub: "+Tech capital, −Democracy itself", fringe: true,
      fx: { big_business: 22, wall_street: 18, civil_rights: -26, labor: -22, stability: -24, approval: -10 },
      trait: { strength: "A handful of very rich people will fund anything you put your name to.", limit: "You are asking an elected chamber to vote for its own abolition.", files: "procedure" } },
  ],

  Independent: [
    { value: "Radical Centrist", axis: 0.0, economic: 0.1, diplomatic: -0.2, liberty: -0.2, culture: -0.1, pluralism: 0.2, sub: "Balanced — a plague on both their houses",
      fx: { stability: 4, approval: 2 },
      trait: { strength: "Both sides will negotiate with you, which in a hung chamber is the only power there is.", limit: "Neither side will die for you. When it is close you are on your own.", files: "procedure" } },
    { value: "Reform Populist", axis: -0.05, economic: -0.1, diplomatic: 0.4, liberty: 0.2, culture: 0.1, pluralism: 0.1, sub: "+Reform base, +Labour, −Wall St, −Establishment",
      fx: { labor: 10, approval: 4, wall_street: -14, big_business: -10, stability: -4 } },
    { value: "Libertarian", axis: 0.4, economic: 0.95, diplomatic: -0.2, liberty: 0.95, culture: -0.1, pluralism: 0.15, sub: "+Free markets, +Gun owners, −Regulators, −Welfare state",
      fx: { gun_owners: 18, big_business: 14, wall_street: 10, labor: -14, pentagon: -8 } },
    { value: "Green", axis: -0.65, economic: -0.6, diplomatic: -0.6, liberty: 0, culture: -0.6, pluralism: 0.6, sub: "+Environmentalists hard, −Fossil fuels, −Heavy industry",
      fx: { greens: 24, civil_rights: 8, big_business: -16, labor: -6 } },
    { value: "Technocrat", axis: 0.05, economic: 0.1, diplomatic: -0.5, liberty: -0.5, culture: -0.6, pluralism: 0.15, sub: "+Institutions, +Business, −Mass appeal",
      fx: { stability: 14, big_business: 10, wall_street: 6, approval: -6 } },
    { value: "Georgist", axis: -0.3, economic: -0.2, diplomatic: -0.2, liberty: 0.1, culture: -0.2, pluralism: 0.3, sub: "Tax the land, untax the work. −Landlords, −Wall St",
      fx: { labor: 14, big_business: 6, wall_street: -18, stability: -4 } },
    { value: "Distributist", axis: 0.15, economic: -0.2, diplomatic: 0.3, liberty: 0.2, culture: 0.6, pluralism: 0, sub: "+Faith, +Small business, −Big business, −Wall St",
      fx: { faith: 14, labor: 8, big_business: -18, wall_street: -14 } },
    { value: "Agrarian Populist", axis: 0.2, economic: -0.2, diplomatic: 0.6, liberty: 0.3, culture: 0.6, pluralism: -0.15, sub: "+Rural labour, +Gun owners, −Wall St",
      fx: { labor: 12, gun_owners: 12, faith: 8, wall_street: -20, big_business: -10 } },
    { value: "Civic Nationalist", axis: 0.4, economic: 0.3, diplomatic: 0.7, liberty: -0.3, culture: 0.4, pluralism: -0.25, sub: "+Pentagon, +Stability, −Globalists",
      fx: { pentagon: 14, gun_owners: 8, stability: 6, big_business: -8 } },
    { value: "Cosmopolitan Globalist", axis: -0.15, economic: 0.5, diplomatic: -0.9, liberty: -0.4, culture: -0.4, pluralism: 0.55, sub: "+Business, +Institutions, −Populists",
      fx: { big_business: 16, wall_street: 12, stability: 8, labor: -12, gun_owners: -10, approval: -4 } },
    { value: "Digital Rights / Pirate", axis: -0.3, economic: -0.1, diplomatic: -0.4, liberty: 0.9, culture: -0.6, pluralism: 0.65, sub: "+Civil rights, −Big tech, −Surveillance state",
      fx: { civil_rights: 18, big_business: -12, pentagon: -12, stability: -4 } },

    // --- Fringe & radical ---
    { value: "Communist", axis: -0.95, economic: -1, diplomatic: 0, liberty: -0.85, culture: -0.3, pluralism: 0.2, sub: "+Labour hard, −Wall St, −Big business, −Stability", fringe: true,
      fx: { labor: 28, civil_rights: 12, wall_street: -32, big_business: -28, stability: -20, approval: -6 } },
    { value: "Anarcho-Syndicalist", axis: -0.95, economic: -0.95, diplomatic: -0.3, liberty: 0.9, culture: -0.5, pluralism: 0.6, sub: "No state, no bosses. −Almost every institution", fringe: true,
      fx: { labor: 30, civil_rights: 14, wall_street: -30, big_business: -26, pentagon: -22, stability: -26 } },
    { value: "Theocrat", axis: 0.95, economic: 0.1, diplomatic: 0.6, liberty: -0.9, culture: 1, pluralism: -0.85, sub: "Scripture as statute. −Everyone outside the church", reflex: { restrict_abortion: "yes" }, fringe: true,
      fx: { faith: 32, civil_rights: -30, big_business: -14, greens: -8, stability: -20, approval: -8 } },
    { value: "Monarchist", axis: 0.8, economic: 0.3, diplomatic: 0.4, liberty: -0.8, culture: 1, pluralism: -0.6, sub: "Restore the crown. −The entire constitutional order", fringe: true,
      fx: { stability: -24, civil_rights: -20, faith: 12, pentagon: 8, approval: -10 } },
    { value: "Accelerationist", axis: 0.5, economic: 0.5, diplomatic: -0.2, liberty: 0.4, culture: -0.5, pluralism: -0.2, sub: "Break it faster. −Stability, −Everything downstream", fringe: true,
      fx: { big_business: 10, stability: -30, labor: -14, civil_rights: -12, approval: -8 } },
    { value: "Transhumanist", axis: 0.1, economic: 0.4, diplomatic: -0.5, liberty: 0.3, culture: -0.95, pluralism: 0.3, sub: "+Big tech hard, −Faith, −Labour",
      fringe: true,
      fx: { big_business: 22, wall_street: 10, faith: -22, labor: -12, stability: -8 } },
    { value: "Primitivist", axis: -0.7, economic: -0.5, diplomatic: 0.2, liberty: 0, culture: 0.2, pluralism: -0.1, sub: "Unwind the industrial age. −The economy, entirely", fringe: true,
      fx: { greens: 30, big_business: -30, wall_street: -26, labor: -20, stability: -22, approval: -12 } },
    { value: "Military Junta", axis: 0.8, economic: 0.2, diplomatic: 0.8, liberty: -1, culture: 0.7, pluralism: -0.8, sub: "+Pentagon hard, −The republic", fringe: true,
      fx: { pentagon: 30, gun_owners: 10, civil_rights: -30, labor: -12, stability: -18, approval: -8 } },
    { value: "Longtermist", axis: 0.1, economic: 0.3, diplomatic: -0.7, liberty: -0.4, culture: -0.7, pluralism: 0.1, sub: "Govern for the century. −Everyone alive now", fringe: true,
      fx: { greens: 14, big_business: 10, stability: 6, labor: -14, approval: -10 } },

    // --- Added ---------------------------------------------------------------
    { value: "Municipalist", axis: -0.5, economic: -0.5, diplomatic: 0.2, liberty: 0.4, culture: -0.4, pluralism: 0.5, sub: "+Cities, +Labour, anti-federal",
      fx: { labor: 10, civil_rights: 8, stability: -6 },
      trait: { strength: "Mayors and city halls act on your bills before Washington does.", limit: "No statewide seat will ever elect you.", files: "housing" } },
    { value: "Syncretic Populist", axis: 0.05, economic: -0.2, diplomatic: 0.6, liberty: 0, culture: 0.3, pluralism: -0.1, sub: "+Labour, +Faith, −Institutions",
      fx: { labor: 12, faith: 10, wall_street: -14, stability: -8 },
      trait: { strength: "You can build a majority nobody else in the chamber can assemble.", limit: "Neither caucus will give you a gavel.", files: "trade" } },
    { value: "Pacifist", axis: -0.4, economic: -0.3, diplomatic: -0.9, liberty: 0.5, culture: -0.3, pluralism: 0.7, sub: "−Pentagon hard, +Civil rights",
      fx: { pentagon: -24, civil_rights: 12, greens: 6 },
      trait: { strength: "You can force a war-powers vote nobody wants to take.", limit: "Any deployment destroys your standing at home.", files: "warpowers" } },
    { value: "Frontier Libertarian", axis: 0.6, economic: 0.85, diplomatic: 0.4, liberty: 0.9, culture: 0.3, pluralism: -0.05, sub: "+Gun owners, −Federal power",
      fx: { gun_owners: 22, stability: -10, big_business: 6 },
      trait: { strength: "Rural western seats are yours for the asking.", limit: "You cannot pass anything that spends money.", files: "landuse" } },
    { value: "Corporatist", axis: 0.25, economic: 0.3, diplomatic: 0.2, liberty: -0.5, culture: 0.3, pluralism: -0.15, sub: "+Business, +Labour, −Consumers",
      fx: { big_business: 16, labor: 10, wall_street: 8, civil_rights: -8 },
      trait: { strength: "Industry and unions will sit at the same table for you.", limit: "Reformers of both parties treat you as the problem.", files: "industry" } },
    { value: "Technocratic Centrist", axis: 0.0, economic: 0.2, diplomatic: -0.4, liberty: -0.5, culture: -0.4, pluralism: 0.15, sub: "+Institutions hard, −Everyone else",
      fx: { stability: 14, big_business: 6, labor: -6, approval: -4 },
      trait: { strength: "Your numbers are trusted even by people who hate you.", limit: "You have no base at all.", files: "budget" } },
    { value: "Left Nationalist", axis: -0.65, economic: -0.7, diplomatic: 0.7, liberty: -0.2, culture: 0.1, pluralism: 0.1, sub: "+Labour hard, +Tariffs, −Globalists",
      fx: { labor: 20, big_business: -12, wall_street: -16, greens: -6 },
      trait: { strength: "Industrial seats will follow you across party lines.", limit: "Cosmopolitan donors will not touch you.", files: "trade" } },
    { value: "Communitarian", axis: -0.15, economic: -0.2, diplomatic: 0.3, liberty: -0.3, culture: 0.5, pluralism: 0.15, sub: "+Faith, +Labour, −Individualists",
      fx: { faith: 14, labor: 8, civil_rights: -6, stability: 6 },
      trait: { strength: "Faith institutions and unions both open doors for you.", limit: "Civil-liberties groups campaign against you.", files: "family" } },

    // --- Added: radicals who belong to neither party -------------------------
    { value: "Ethnonationalist", axis: 0.95, economic: 0, diplomatic: 0.95, liberty: -0.6, culture: 0.85, pluralism: -1, sub: "+Nativists hard, −Civil rights hard, −Stability hard", reflex: { weaken_civil_rights: "yes", expand_deportation: "yes" }, fringe: true,
      fx: { gun_owners: 18, faith: 10, civil_rights: -34, big_business: -20, wall_street: -16, stability: -26, approval: -12 },
      trait: { strength: "A committed base that no scandal disperses.", limit: "Every other bloc in the chamber organises against you personally.", files: "procedure" } },
    { value: "Climate Emergency", axis: -0.9, economic: -0.7, diplomatic: -0.6, liberty: -0.7, culture: -0.7, pluralism: 0.45, sub: "+Greens hard, −Industry, emergency powers", fringe: true,
      fx: { greens: 32, civil_rights: 6, big_business: -28, wall_street: -22, labor: -14, stability: -18, approval: -8 },
      trait: { strength: "A disaster is your mandate, and there is always another disaster.", limit: "In a calm year nobody will take your calls.", files: "energy" } },
    { value: "Populist Nationalist", axis: 0.7, economic: -0.2, diplomatic: 0.85, liberty: 0, culture: 0.5, pluralism: -0.4, sub: "+Labour, +Gun owners, −Institutions, −Trade", fringe: true,
      fx: { labor: 14, gun_owners: 18, faith: 12, wall_street: -24, big_business: -18, stability: -16, approval: -2 },
      trait: { strength: "You take votes off both parties in seats neither can hold.", limit: "Neither caucus will ever give you a gavel.", files: "trade" } },
    { value: "Crypto-Anarchist", axis: 0.55, economic: 0.9, diplomatic: -0.3, liberty: 0.95, culture: -0.4, pluralism: 0.2, sub: "+Tech capital, −State capacity hard", fringe: true,
      fx: { big_business: 16, wall_street: 14, stability: -28, labor: -18, civil_rights: 6, pentagon: -16, approval: -8 },
      trait: { strength: "Money reaches you through channels no ethics committee can trace.", limit: "You cannot fund anything, because you do not believe in funding things.", files: "budget" } },
    { value: "Localist Secessionist", axis: 0.4, economic: 0.4, diplomatic: 0.7, liberty: 0.8, culture: 0.5, pluralism: -0.35, sub: "−Federal power hard, +Local control", fringe: true,
      fx: { gun_owners: 14, faith: 8, stability: -30, civil_rights: -10, pentagon: -14, approval: -6 },
      trait: { strength: "Whole state legislatures will pass your model bills.", limit: "You are in Congress to dismantle the thing you were elected to.", files: "procedure" } },
    { value: "Technocratic Authoritarian", axis: 0.3, economic: 0.4, diplomatic: -0.3, liberty: -0.95, culture: -0.3, pluralism: -0.45, sub: "+Institutions hard, −Democracy", fringe: true,
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
export const ISSUE_KEYS = ["economic", "diplomatic", "liberty", "culture", "pluralism"];

/**
 * `economic` -> `ideologyEconomic`, the shape the scenario carries.
 *
 * Named `issueKey` rather than `scenarioKey` because the sanitised scenario
 * already has a field by that name — the preset a game was started from — and
 * two different meanings under one word in one file is how a bug gets written.
 */
export const issueKey = (id) => `ideology${id[0].toUpperCase()}${id.slice(1)}`;

export function ideologyPosition(party, value) {
  const found = findIdeology(party, value);
  const out = {
    ideologyAxis: found?.axis ?? 0,
    ideologyIntensity: found?.fringe ? 1.7 : 1,
  };
  // All four, carried onto the scenario the way the axis is, because every
  // stance in the chamber now reads whichever of them a bill stakes a claim on.
  for (const id of ISSUE_KEYS) out[issueKey(id)] = found?.[id] ?? 0;
  return out;
}
