import { Router } from "express";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { assignTeacher, createClass, getClass, getClassTimetable, listClasses, listMyClasses, setClassSubjects, setClassTimetable, updateClass, } from "./class.controller.js";
const router = Router();
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);
router.get("/mine", requireRoles("ADMIN", "TEACHER"), listMyClasses);
router.get("/", requireRoles("ADMIN", "TEACHER"), listClasses);
router.get("/:id/timetable", requireRoles("ADMIN", "TEACHER"), getClassTimetable);
router.put("/:id/timetable", requireRoles("ADMIN"), setClassTimetable);
router.get("/:id", requireRoles("ADMIN", "TEACHER"), getClass);
router.post("/", requireRoles("ADMIN"), createClass);
router.patch("/:id", requireRoles("ADMIN"), updateClass);
router.put("/:id/subjects", requireRoles("ADMIN"), setClassSubjects);
router.post("/:id/teachers", requireRoles("ADMIN"), assignTeacher);
export default router;
//# sourceMappingURL=class.route.js.map