export declare class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string);
}
export declare function badRequest(message: string): AppError;
export declare function unauthorized(message?: string): AppError;
export declare function forbidden(message?: string): AppError;
export declare function notFound(message?: string): AppError;
export declare function conflict(message: string): AppError;
//# sourceMappingURL=errors.d.ts.map