import { Router } from "express";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { createAcademicYear, listAcademicYears, updateAcademicYear, } from "./academic-year.controller.js";
const router = Router();
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription, requireRoles("ADMIN"));
router.get("/", listAcademicYears);
router.post("/", createAcademicYear);
router.patch("/:id", updateAcademicYear);
export default router;
//# sourceMappingURL=academic-year.route.js.map