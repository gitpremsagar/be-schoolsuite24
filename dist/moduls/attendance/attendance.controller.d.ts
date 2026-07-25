import type { Request, Response } from "express";
export declare function getClassAttendance(req: Request, res: Response): Promise<void>;
/** Full-month student attendance register for a class, or all classes. */
export declare function getClassMonthlyAttendance(req: Request, res: Response): Promise<void>;
/** Bulk save student attendance marks across multiple days. */
export declare function upsertStudentMonthlyAttendance(req: Request, res: Response): Promise<void>;
export declare function upsertStudentAttendance(req: Request, res: Response): Promise<void>;
export declare function punchIn(req: Request, res: Response): Promise<void>;
export declare function punchOut(req: Request, res: Response): Promise<void>;
export declare function getMyStaffAttendanceToday(req: Request, res: Response): Promise<void>;
/** Own staff attendance month register (teacher/employee self-service). */
export declare function getMyStaffMonthlyAttendance(req: Request, res: Response): Promise<void>;
export declare function listStaffAttendance(req: Request, res: Response): Promise<void>;
/** Full-month staff attendance register for the school. */
export declare function getStaffMonthlyAttendance(req: Request, res: Response): Promise<void>;
/** Bulk save staff attendance marks across multiple days. */
export declare function upsertStaffMonthlyAttendance(req: Request, res: Response): Promise<void>;
export declare function getMyStudentAttendance(req: Request, res: Response): Promise<void>;
export declare function upsertStaffDayAttendance(req: Request, res: Response): Promise<void>;
/** @deprecated Prefer upsertStaffDayAttendance */
export declare function correctStaffAttendance(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=attendance.controller.d.ts.map