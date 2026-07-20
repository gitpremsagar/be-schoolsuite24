export class AppError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = "AppError";
    }
}
export function badRequest(message) {
    return new AppError(400, message);
}
export function unauthorized(message = "Unauthorized") {
    return new AppError(401, message);
}
export function forbidden(message = "Forbidden") {
    return new AppError(403, message);
}
export function notFound(message = "Not found") {
    return new AppError(404, message);
}
export function conflict(message) {
    return new AppError(409, message);
}
//# sourceMappingURL=errors.js.map