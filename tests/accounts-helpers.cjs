"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} = require("node:crypto");
function fixture(t) {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "acira-local-setup-test-"),
    ),
    key = randomBytes(32);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString(value) {
        const nonce = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", key, nonce);
        return Buffer.concat([
          nonce,
          cipher.update(value),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
      },
      decryptString(value) {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          value.subarray(0, 12),
        );
        decipher.setAuthTag(value.subarray(-16));
        return Buffer.concat([
          decipher.update(value.subarray(12, -16)),
          decipher.final(),
        ]).toString();
      },
    },
  };
}
module.exports = { fixture };
