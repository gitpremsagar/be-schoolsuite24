import type { NextFunction, Request, Response } from "express";
/** School owner registration: creates ADMIN + School + trial subscription. */
export declare function register(req: Request, res: Response): Promise<void>;
export declare function login(req: Request, res: Response): Promise<void>;
export declare function refresh(req: Request, res: Response): Promise<void>;
export declare function logout(_req: Request, res: Response): Promise<void>;
export declare function me(req: Request, res: Response): Promise<void>;
export declare function handleControllerError(res: Response, error: unknown, fallback: string): void;
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.controller.d.ts.map