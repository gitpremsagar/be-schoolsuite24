import { Router } from "express";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { getMySchool, getSchoolDashboard, updateMySchool, } from "./school.controller.js";
const router = Router();
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription, requireRoles("ADMIN", "TEACHER", "EMPLOYEE", "STUDENT"));
router.get("/me", getMySchool);
router.patch("/me", requireRoles("ADMIN"), updateMySchool);
router.get("/dashboard", requireRoles("ADMIN"), getSchoolDashboard);
export default router;
//# sourceMappingURL=school.route.js.map