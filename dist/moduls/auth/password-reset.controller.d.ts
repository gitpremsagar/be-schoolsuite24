import type { Request, Response } from "express";
/**
 * Request a password reset link.
 * Always responds with the same message so accounts cannot be enumerated.
 */
export declare function forgotPassword(req: Request, res: Response): Promise<void>;
/** Consume a reset token and set a new password. The token is single use. */
export declare function resetPassword(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=password-reset.controller.d.ts.map