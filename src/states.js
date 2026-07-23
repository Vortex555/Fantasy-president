// US states + DC: electoral votes, tile-grid map coordinates (row/col),
// and a rough partisan lean (negative = Democratic, positive = Republican).
// The tile grid renders a recognizable map without a huge SVG.

export const STATES = {
  AK: { name: "Alaska",          ev: 3,  r: 0, c: 0,  lean:  15 },
  ME: { name: "Maine",           ev: 4,  r: 0, c: 11, lean:  -9 },
  VT: { name: "Vermont",         ev: 3,  r: 1, c: 10, lean: -35 },
  NH: { name: "New Hampshire",   ev: 4,  r: 1, c: 11, lean:  -7 },

  WA: { name: "Washington",      ev: 12, r: 2, c: 0,  lean: -19 },
  ID: { name: "Idaho",           ev: 4,  r: 2, c: 1,  lean:  30 },
  MT: { name: "Montana",         ev: 4,  r: 2, c: 2,  lean:  16 },
  ND: { name: "North Dakota",    ev: 3,  r: 2, c: 3,  lean:  33 },
  MN: { name: "Minnesota",       ev: 10, r: 2, c: 4,  lean:  -7 },
  IL: { name: "Illinois",        ev: 19, r: 2, c: 5,  lean: -17 },
  WI: { name: "Wisconsin",       ev: 10, r: 2, c: 6,  lean:  -1 },
  MI: { name: "Michigan",        ev: 15, r: 2, c: 8,  lean:  -3 },
  NY: { name: "New York",        ev: 28, r: 2, c: 9,  lean: -23 },
  MA: { name: "Massachusetts",   ev: 11, r: 2, c: 10, lean: -34 },
  RI: { name: "Rhode Island",    ev: 4,  r: 2, c: 11, lean: -21 },

  OR: { name: "Oregon",          ev: 8,  r: 3, c: 0,  lean: -16 },
  NV: { name: "Nevada",          ev: 6,  r: 3, c: 1,  lean:  -2 },
  WY: { name: "Wyoming",         ev: 3,  r: 3, c: 2,  lean:  43 },
  SD: { name: "South Dakota",    ev: 3,  r: 3, c: 3,  lean:  27 },
  IA: { name: "Iowa",            ev: 6,  r: 3, c: 4,  lean:   8 },
  IN: { name: "Indiana",         ev: 11, r: 3, c: 5,  lean:  16 },
  OH: { name: "Ohio",            ev: 17, r: 3, c: 6,  lean:   8 },
  PA: { name: "Pennsylvania",    ev: 19, r: 3, c: 7,  lean:  -1 },
  NJ: { name: "New Jersey",      ev: 14, r: 3, c: 8,  lean: -16 },
  CT: { name: "Connecticut",     ev: 7,  r: 3, c: 9,  lean: -20 },

  CA: { name: "California",      ev: 54, r: 4, c: 0,  lean: -30 },
  UT: { name: "Utah",            ev: 6,  r: 4, c: 1,  lean:  20 },
  CO: { name: "Colorado",        ev: 10, r: 4, c: 2,  lean: -13 },
  NE: { name: "Nebraska",        ev: 5,  r: 4, c: 3,  lean:  25 },
  MO: { name: "Missouri",        ev: 10, r: 4, c: 4,  lean:  16 },
  KY: { name: "Kentucky",        ev: 8,  r: 4, c: 5,  lean:  26 },
  WV: { name: "West Virginia",   ev: 4,  r: 4, c: 6,  lean:  39 },
  VA: { name: "Virginia",        ev: 13, r: 4, c: 7,  lean: -10 },
  MD: { name: "Maryland",        ev: 10, r: 4, c: 8,  lean: -33 },
  DE: { name: "Delaware",        ev: 3,  r: 4, c: 9,  lean: -19 },

  AZ: { name: "Arizona",         ev: 11, r: 5, c: 1,  lean:  -1 },
  NM: { name: "New Mexico",      ev: 5,  r: 5, c: 2,  lean: -11 },
  KS: { name: "Kansas",          ev: 6,  r: 5, c: 3,  lean:  15 },
  AR: { name: "Arkansas",        ev: 6,  r: 5, c: 4,  lean:  28 },
  TN: { name: "Tennessee",       ev: 11, r: 5, c: 5,  lean:  23 },
  NC: { name: "North Carolina",  ev: 16, r: 5, c: 6,  lean:   3 },
  SC: { name: "South Carolina",  ev: 9,  r: 5, c: 7,  lean:  12 },
  DC: { name: "Dist. of Columbia", ev: 3, r: 5, c: 8, lean: -80 },

  OK: { name: "Oklahoma",        ev: 7,  r: 6, c: 3,  lean:  33 },
  LA: { name: "Louisiana",       ev: 8,  r: 6, c: 4,  lean:  19 },
  MS: { name: "Mississippi",     ev: 6,  r: 6, c: 5,  lean:  17 },
  AL: { name: "Alabama",         ev: 9,  r: 6, c: 6,  lean:  25 },
  GA: { name: "Georgia",         ev: 16, r: 6, c: 7,  lean:   0 },

  TX: { name: "Texas",           ev: 40, r: 7, c: 3,  lean:   6 },
  FL: { name: "Florida",         ev: 30, r: 7, c: 7,  lean:   3 },

  HI: { name: "Hawaii",          ev: 4,  r: 8, c: 0,  lean: -29 },
};

export const STATE_CODES = Object.keys(STATES);
export const TOTAL_EV = Object.values(STATES).reduce((s, x) => s + x.ev, 0); // 538
