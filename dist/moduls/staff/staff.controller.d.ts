import type { Request, Response } from "express";
export declare function listStaff(req: Request, res: Response): Promise<void>;
export declare function createStaff(req: Request, res: Response): Promise<void>;
export declare function getStaff(req: Request, res: Response): Promise<void>;
export declare function updateStaff(req: Request, res: Response): Promise<void>;
export declare function deleteStaff(req: Request, res: Response): Promise<void>;
/** Permanently delete staff after verifying the admin's own password. */
export declare function purgeStaff(req: Request, res: Response): Promise<void>;
export declare function getMyStaffProfile(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=staff.controller.d.ts.map