'use strict';
// Public 14.4 membership (24 Nov): which tier a certificate's number belongs to, in the main process. The SAME line as src/features/feedback/sealNumbers.ts (FOUNDING_LAST, certificateTier), which this process cannot import;
// tests/membership-service.test.cjs reads that file's text and fails when the two numbers differ. A certificate numbered 1 to FOUNDING_LAST is a Founding Contributor (rank 'founding'), a higher number an Insider (rank 'insider').
// The number alone decides: never the certificate's `by` field.
const FOUNDING_LAST = 100;

/** 'founding' | 'insider' for a certificate number, or null when it is not a whole number of at least 1. */
function certificateTier(number) {
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 ? (number <= FOUNDING_LAST ? 'founding' : 'insider') : null;
}

module.exports = { FOUNDING_LAST, certificateTier };
