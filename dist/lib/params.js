import { badRequest } from "./errors.js";
export function param(req, name) {
    const value = req.params[name];
    if (typeof value !== "string" || !value) {
        throw badRequest(`${name} is required`);
    }
    return value;
}
//# sourceMappingURL=params.js.map