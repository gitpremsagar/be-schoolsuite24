import type { Request, Response } from "express";
/**
 * Change the signed-in user's login email.
 * Requires the current password, rejects duplicates and re-issues tokens so
 * the session keeps working with the new identity.
 */
export declare function changeEmail(req: Request, res: Response): Promise<void>;
/**
 * Change the signed-in user's password after verifying the current one.
 * Bumps tokenVersion to sign out other devices, then re-issues tokens so this
 * device stays signed in.
 */
export declare function changePassword(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=account.controller.d.ts.map