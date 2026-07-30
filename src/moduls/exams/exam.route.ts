import { Router } from "express";
import {
  requireAuth,
  requireActiveSubscription,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import {
  createExamination,
  deleteExamination,
  getExamination,
  listExaminations,
  listMarkSheets,
  listMyMarkSheets,
  publishMarkSheets,
  saveMarkSheets,
  updateExamination,
} from "./exam.controller.js";

const router = Router();

router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);

router.get(
  "/me/marksheets",
  requireRoles("STUDENT"),
  listMyMarkSheets,
);

router.get("/", requireRoles("ADMIN", "TEACHER"), listExaminations);
router.post("/", requireRoles("ADMIN", "TEACHER"), createExamination);
router.get("/:id", requireRoles("ADMIN", "TEACHER"), getExamination);
router.patch("/:id", requireRoles("ADMIN", "TEACHER"), updateExamination);
router.delete("/:id", requireRoles("ADMIN", "TEACHER"), deleteExamination);
router.get(
  "/:id/marksheets",
  requireRoles("ADMIN", "TEACHER"),
  listMarkSheets,
);
router.put(
  "/:id/marksheets",
  requireRoles("ADMIN", "TEACHER"),
  saveMarkSheets,
);
router.post(
  "/:id/marksheets/publish",
  requireRoles("ADMIN", "TEACHER"),
  publishMarkSheets,
);

export default router;
