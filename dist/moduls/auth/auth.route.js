import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { login, logout, me, refresh, register } from "./auth.controller.js";
import { changeEmail } from "./account.controller.js";
import { forgotPassword, resetPassword, } from "./password-reset.controller.js";
const router = Router();
router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", requireAuth, me);
router.patch("/me/email", requireAuth, changeEmail);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
export default router;
//# sourceMappingURL=auth.route.js.map