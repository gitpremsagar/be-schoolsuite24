import { badRequest } from "../../lib/errors.js";

/** Shared password strength rules for any flow that sets a new password. */
export function validatePassword(password: string) {
  if (password.length < 8) {
    throw badRequest("Password must be at least 8 characters");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw badRequest("Password must include at least one letter and one number");
  }
  if (password.length > 128) {
    throw badRequest("Password is too long");
  }
}
