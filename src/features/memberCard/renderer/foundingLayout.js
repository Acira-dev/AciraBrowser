// Beta 14 member cards: the Founding Contributor layout, as numbers. No imports, so a test can read it without a browser.
// Every value is the reference design's (the cards sample, "Founding Contributor", card d5d, 16 Nov 2026).
export const CARD_W = 1600, CARD_H = 2400;
export const FOUNDING_LAYOUT = {
  // the centred watch dial: its outer edge sits on the 100 px margins left, right and top (800 - 700 = 100)
  dial: [800, 800, 700],
  // the swirl (guilloche) disc: rings from r 200 to r 385 around the token
  rosette: [200, 385],
  // the colour compass token: 300 px, exactly at the dial centre
  token: [800, 800, 300],
  // the token's seat in the swirl: radius = token / 2 + 40
  seatPad: 40,
  // the part of the seat the hands' relief plate leaves uncovered: [x, y, r]
  qExclude: [800, 800, 165],
  // the hand art: layout DB (arms turned 20 degrees from the fresco, God's thumb separated)
  hands: 'DB',
  // each index fingertip stops this far short of the token rim (about 1 mm); measured on the shipped art in tests/member-card-founding.test.ts
  fingertipGap: 30,
  // the bezel plate: smooth turned platinum (no speckle), turned grain about the dial centre, its height softened a touch
  bezel: { ring: [800, 800], ringK: 1.0, smooth: 1, bump: 5 },
  bezelBlur: 2.5,
  // the number: Oxanium 500, starts at cap 450 px and shrinks until its right ink edge is at x 1500; the name and "member since" sit at x 100, baseline y 2300
  number: { x: 100, y: 1950, cap: 450, rightEdge: 1500 },
  // the rank words, right aligned on x 1500 (cap lines y 2175 and 2250)
  words: ['FOUNDING', 'CONTRIBUTOR'], wordsRight: 1500,
  // the card rules (the plan): every number sits at least 4 % of the card's width (64 px) from any edge
  minEdge: 64,
};
