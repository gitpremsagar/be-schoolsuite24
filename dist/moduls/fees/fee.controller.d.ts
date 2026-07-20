import type { Request, Response } from "express";
/** Inclusive calendar months between two dates (UTC). */
export declare function monthsInRange(start: Date, end: Date): Array<{
    year: number;
    month: number;
    key: string;
    label: string;
}>;
export declare function getFeeRegister(req: Request, res: Response): Promise<void>;
export declare function listGradeFees(req: Request, res: Response): Promise<void>;
export declare function upsertGradeFees(req: Request, res: Response): Promise<void>;
export declare function upsertStudentFeePayment(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=fee.controller.d.ts.map