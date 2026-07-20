import { Router } from "express";
import {
  requireAuth,
  requireActiveSubscription,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import {
  createStaff,
  deleteStaff,
  getMyStaffProfile,
  getStaff,
  listStaff,
  purgeStaff,
  updateStaff,
} from "./staff.controller.js";

const router = Router();

router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);

router.get(
  "/me",
  requireRoles("ADMIN", "TEACHER", "EMPLOYEE"),
  getMyStaffProfile,
);
router.get("/", requireRoles("ADMIN"), listStaff);
router.post("/", requireRoles("ADMIN"), createStaff);
router.get("/:id", requireRoles("ADMIN"), getStaff);
router.patch("/:id", requireRoles("ADMIN"), updateStaff);
router.delete("/:id", requireRoles("ADMIN"), deleteStaff);
router.post("/:id/purge", requireRoles("ADMIN"), purgeStaff);

export default router;
