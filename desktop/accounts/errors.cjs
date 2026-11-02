"use strict";
class SetupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new SetupError(code, message);
};
const object = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
function shape(value, required, optional = []) {
  if (
    !object(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    fail("INVALID_REQUEST", "This setup request is not supported.");
  return value;
}
function text(value, max = 200) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    fail("INVALID_REQUEST", "Enter a valid value.");
  return value.trim();
}
module.exports = { SetupError, fail, object, shape, text };
