import { Router } from "express";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { createSubject, deleteSubject, listSubjects, updateSubject, } from "./subject.controller.js";
const router = Router();
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);
router.get("/", requireRoles("ADMIN", "TEACHER"), listSubjects);
router.post("/", requireRoles("ADMIN"), createSubject);
router.patch("/:id", requireRoles("ADMIN"), updateSubject);
router.delete("/:id", requireRoles("ADMIN"), deleteSubject);
export default router;
//# sourceMappingURL=subject.route.js.map