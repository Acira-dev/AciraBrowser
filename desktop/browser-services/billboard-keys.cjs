'use strict';
// The public keys that Acira trusts for the billboard file (billboard.cjs). A file that is not signed by one of them is ignored.
// An entry is {id, key}: id is the `keyId` the file names, key is the Ed25519 PUBLIC key as 32 raw bytes in base64 (the private key never comes near this repository).
// Several entries are allowed so a key can be replaced: add the new one, publish with it, drop the old one in a later release.
//
// EMPTY ON PURPOSE (Beta 14): the production key pair belongs to the team, who decide who holds the private key. Until its public half is
// pasted here, an installed Acira shows no billboard card at all (nothing can be verified, so nothing is trusted). docs/launch/BETA14_DASHBOARD_CONTRACT.md,
// section "Billboard", says how the key is made and how the publisher signs.
// Tests never use this list: they pass a throw-away test key (tests/billboard.test.cjs); a test profile can name one more key in the environment (billboard.cjs testKeys).
const PRODUCTION_KEYS = Object.freeze([]);

module.exports = { PRODUCTION_KEYS };
