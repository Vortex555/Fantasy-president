/**
 * The eight organised interests, and which way each of them leans.
 *
 * Lifted out of gameEngine.js into a leaf module of its own. Not tidying for its
 * own sake: the congressional coalition needs this list, gameEngine imports the
 * chamber modules to build their careers, and so anything the chambers reach for
 * inside gameEngine closes an import cycle. A list of eight constants with no
 * dependencies of its own cannot participate in one.
 *
 * `lean` is the bloc's own politics on the same −1…+1 spectrum as an ideology and
 * a bill, which is what lets a bill's position be turned into a reaction without
 * anybody writing one out by hand.
 */
export const STAKEHOLDERS = [
  { id: "wall_street", name: "Wall Street",        lean:  1 },
  { id: "big_business", name: "Big Business",      lean:  1 },
  { id: "pentagon",     name: "The Pentagon",      lean:  0.5 },
  { id: "labor",        name: "Labor Unions",      lean: -1 },
  { id: "greens",       name: "Environmentalists", lean: -1 },
  { id: "civil_rights", name: "Civil Rights Orgs", lean: -1 },
  { id: "gun_owners",   name: "Gun Owners",        lean:  1 },
  { id: "faith",        name: "Faith Communities", lean:  0.7 },
];

export const stakeholderById = (id) => STAKEHOLDERS.find((s) => s.id === id) || null;
