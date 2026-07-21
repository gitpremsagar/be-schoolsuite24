import type { Request, Response } from "express";
export declare function listStudents(req: Request, res: Response): Promise<void>;
export declare function createStudent(req: Request, res: Response): Promise<void>;
export declare function bulkCreateStudents(req: Request, res: Response): Promise<void>;
export declare function enrollStudent(req: Request, res: Response): Promise<void>;
export declare function getStudent(req: Request, res: Response): Promise<void>;
export declare function updateStudent(req: Request, res: Response): Promise<void>;
export declare function getMyStudentProfile(req: Request, res: Response): Promise<void>;
/** Permanently delete a student after verifying the admin's own password. */
export declare function purgeStudent(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=student.controller.d.ts.map