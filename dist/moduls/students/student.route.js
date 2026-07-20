import { Router } from "express";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { bulkCreateStudents, createStudent, enrollStudent, getMyStudentProfile, getStudent, listStudents, updateStudent, } from "./student.controller.js";
const router = Router();
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);
router.get("/me", requireRoles("STUDENT"), getMyStudentProfile);
router.get("/", requireRoles("ADMIN", "TEACHER"), listStudents);
router.post("/bulk", requireRoles("ADMIN"), bulkCreateStudents);
router.post("/", requireRoles("ADMIN"), createStudent);
router.get("/:id", requireRoles("ADMIN", "TEACHER"), getStudent);
router.patch("/:id", requireRoles("ADMIN"), updateStudent);
router.post("/:id/enrollments", requireRoles("ADMIN"), enrollStudent);
export default router;
//# sourceMappingURL=student.route.js.map