import { Router } from "express";
import {
  requireAuth,
  requireActiveSubscription,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import {
  assignTeacher,
  createClass,
  listClasses,
  listMyClasses,
  updateClass,
} from "./class.controller.js";

const router = Router();

router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);

router.get("/mine", requireRoles("ADMIN", "TEACHER"), listMyClasses);
router.get("/", requireRoles("ADMIN", "TEACHER"), listClasses);
router.post("/", requireRoles("ADMIN"), createClass);
router.patch("/:id", requireRoles("ADMIN"), updateClass);
router.post("/:id/teachers", requireRoles("ADMIN"), assignTeacher);

export default router;
