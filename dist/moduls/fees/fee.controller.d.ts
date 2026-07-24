import type { Request, Response } from "express";
import type { FeeStatus } from "@prisma/client";
/** Inclusive calendar months between two dates (UTC). */
export declare function monthsInRange(start: Date, end: Date): Array<{
    year: number;
    month: number;
    key: string;
    label: string;
}>;
/**
 * Fee liability starts in the admission month (inclusive).
 * Months strictly before joiningDate are not applicable.
 * Missing joiningDate keeps all months applicable (legacy behavior).
 */
export declare function isFeeMonthApplicable(joiningDate: Date | null | undefined, year: number, month: number): boolean;
/**
 * amountDue is the remaining balance; amountPaid is what was paid.
 * Legacy rows stored the full fee in amountDue — normalize those on read.
 */
export declare function normalizeFeeAmounts(input: {
    status: FeeStatus;
    amountDue: number;
    amountPaid: number;
    feeHint?: number | null;
}): {
    status: FeeStatus;
    amountDue: number;
    amountPaid: number;
    feeAmount: number;
};
/** Derive remaining due + status from fee and paid amounts. */
export declare function resolvePaymentTotals(input: {
    feeAmount: number;
    amountPaid: number;
    status?: FeeStatus;
}): {
    status: FeeStatus;
    feeAmount: number;
    amountPaid: number;
    amountDue: number;
};
export declare function getFeeRegister(req: Request, res: Response): Promise<void>;
export declare function listGradeFees(req: Request, res: Response): Promise<void>;
export declare function upsertGradeFees(req: Request, res: Response): Promise<void>;
export declare function upsertStudentFeePayment(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=fee.controller.d.ts.map