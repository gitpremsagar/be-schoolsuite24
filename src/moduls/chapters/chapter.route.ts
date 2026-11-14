import { Router } from "express";
import {
  requireAuth,
  requireActiveSubscription,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import {
  createChapter,
  deleteChapter,
  listChapters,
  moveChapter,
  updateChapter,
} from "./chapter.controller.js";

const router = Router({ mergeParams: true });

router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);

router.get("/", requireRoles("ADMIN", "TEACHER"), listChapters);
router.post("/", requireRoles("ADMIN", "TEACHER"), createChapter);
router.patch("/:chapterId", requireRoles("ADMIN", "TEACHER"), updateChapter);
router.delete("/:chapterId", requireRoles("ADMIN", "TEACHER"), deleteChapter);
router.post("/:chapterId/move", requireRoles("ADMIN", "TEACHER"), moveChapter);

export default router;
