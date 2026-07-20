import type { Request } from "express";
import { badRequest } from "./errors.js";

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !value) {
    throw badRequest(`${name} is required`);
  }
  return value;
}
