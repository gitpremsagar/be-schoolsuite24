import type { Request, Response } from "express";
/**
 * Change the signed-in user's login email.
 * Requires the current password, rejects duplicates and re-issues tokens so
 * the session keeps working with the new identity.
 */
export declare function changeEmail(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=account.controller.d.ts.map