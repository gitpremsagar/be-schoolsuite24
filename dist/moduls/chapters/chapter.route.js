import { Router } from "express";
import multer from "multer";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { badRequest } from "../../lib/errors.js";
import { createChapter, deleteChapter, generateAnswers, generateChapter, generateExercise, listChapters, moveChapter, updateChapter, } from "./chapter.controller.js";
const router = Router({ mergeParams: true });
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 8, fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
        if (!allowed.has(file.mimetype)) {
            cb(badRequest("Only JPEG, PNG, and WebP images are supported"));
            return;
        }
        cb(null, true);
    },
});
function uploadChapterImages(req, res, next) {
    upload.array("images", 8)(req, res, (error) => {
        if (error) {
            next(error instanceof multer.MulterError ? badRequest(error.message) : error);
            return;
        }
        next();
    });
}
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription);
router.get("/", requireRoles("ADMIN", "TEACHER"), listChapters);
router.post("/", requireRoles("ADMIN", "TEACHER"), createChapter);
router.post("/generate", requireRoles("ADMIN", "TEACHER"), uploadChapterImages, generateChapter);
router.post("/:chapterId/exercise/generate", requireRoles("ADMIN", "TEACHER"), uploadChapterImages, generateExercise);
router.post("/:chapterId/answers/generate", requireRoles("ADMIN", "TEACHER"), generateAnswers);
router.patch("/:chapterId", requireRoles("ADMIN", "TEACHER"), updateChapter);
router.delete("/:chapterId", requireRoles("ADMIN", "TEACHER"), deleteChapter);
router.post("/:chapterId/move", requireRoles("ADMIN", "TEACHER"), moveChapter);
export default router;
//# sourceMappingURL=chapter.route.js.map