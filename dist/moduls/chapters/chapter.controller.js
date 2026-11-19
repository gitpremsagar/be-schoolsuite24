import { prisma } from "../../lib/prisma.js";
import { badRequest, forbidden, notFound, AppError } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";
import { generateAnswersDraft, generateChapterDraft, generateExerciseDraft, } from "./chapter-ai.service.js";
async function ensureClassSubject(schoolId, classId, subjectId) {
    const link = await prisma.classSubject.findFirst({
        where: { schoolId, classId, subjectId },
        select: { id: true },
    });
    if (!link) {
        throw notFound("Subject is not assigned to this class");
    }
}
/**
 * Admins can manage any class. A teacher may manage all subjects in a class
 * they are associated with (homeroom or any subject assignment).
 */
async function ensureClassAccess(req, schoolId, classId) {
    const auth = getAuthUser(req);
    if (auth.role !== "TEACHER")
        return;
    const staff = await prisma.staffProfile.findUnique({
        where: { userId: auth.userId },
        select: { id: true },
    });
    if (!staff) {
        throw forbidden("Staff profile required");
    }
    const [homeroom, subjectLink] = await Promise.all([
        prisma.classTeacher.findFirst({
            where: { schoolId, classId, staffProfileId: staff.id },
            select: { id: true },
        }),
        prisma.classSubject.findFirst({
            where: { schoolId, classId, staffProfileId: staff.id },
            select: { id: true },
        }),
    ]);
    if (!homeroom && !subjectLink) {
        throw forbidden("You do not have access to this class");
    }
}
function chapterScope(req) {
    return {
        schoolId: requireSchoolId(req),
        classId: param(req, "id"),
        subjectId: param(req, "subjectId"),
    };
}
const generationLog = new Map();
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
function assertGenerationRateLimit(schoolId) {
    const configured = Number(process.env.AI_GENERATIONS_PER_HOUR ?? 20);
    const limit = Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : 20;
    const now = Date.now();
    const recent = (generationLog.get(schoolId) ?? []).filter((timestamp) => now - timestamp < GENERATION_WINDOW_MS);
    if (recent.length >= limit) {
        throw new AppError(429, `AI generation limit reached (${limit} per hour). Try again later.`);
    }
    recent.push(now);
    generationLog.set(schoolId, recent);
}
async function ensureChapterAccess(req, scope) {
    await ensureClassSubject(scope.schoolId, scope.classId, scope.subjectId);
    await ensureClassAccess(req, scope.schoolId, scope.classId);
}
function parseAnswersInput(value) {
    if (!Array.isArray(value)) {
        throw badRequest("answers must be an array");
    }
    return value.map((item, index) => {
        if (!item || typeof item !== "object") {
            throw badRequest(`answers[${index}] must be an object`);
        }
        const row = item;
        const question = typeof row.question === "string" ? row.question.trim() : "";
        const answer = typeof row.answer === "string" ? row.answer.trim() : "";
        if (!question || !answer) {
            throw badRequest(`answers[${index}] requires question and answer`);
        }
        if (row.explanation !== undefined && typeof row.explanation !== "string") {
            throw badRequest(`answers[${index}].explanation must be a string`);
        }
        const source = row.source === "general"
            ? "general"
            : row.source === "chapter" || row.source === undefined
                ? "chapter"
                : null;
        if (!source) {
            throw badRequest(`answers[${index}].source must be "chapter" or "general"`);
        }
        return {
            question,
            answer,
            explanation: typeof row.explanation === "string" ? row.explanation.trim() : "",
            source,
        };
    });
}
function readUploadedImages(req) {
    const files = req.files ?? [];
    if (files.length === 0) {
        throw badRequest("At least one image is required");
    }
    if (files.length > 8) {
        throw badRequest("A maximum of 8 images is allowed");
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 30 * 1024 * 1024) {
        throw badRequest("The combined image size is too large. Add fewer or smaller photos.");
    }
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    for (const file of files) {
        if (!allowedTypes.has(file.mimetype)) {
            throw badRequest("Only JPEG, PNG, and WebP images are supported. Convert phone photos if needed.");
        }
    }
    return files;
}
function readEffort(req) {
    const { effort } = req.body;
    if (effort !== "low" && effort !== "high" && effort !== "max") {
        throw badRequest("effort must be low, high, or max");
    }
    return effort;
}
export async function listChapters(req, res) {
    try {
        const scope = chapterScope(req);
        await ensureChapterAccess(req, scope);
        const chapters = await prisma.chapter.findMany({
            where: scope,
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        });
        res.json({ chapters });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list chapters");
    }
}
export async function createChapter(req, res) {
    try {
        const scope = chapterScope(req);
        await ensureChapterAccess(req, scope);
        const { title, content, exercise, answers } = req.body;
        const trimmedTitle = typeof title === "string" ? title.trim() : "";
        if (!trimmedTitle) {
            throw badRequest("title is required");
        }
        if (content !== undefined && typeof content !== "string") {
            throw badRequest("content must be a string");
        }
        if (exercise !== undefined && typeof exercise !== "string") {
            throw badRequest("exercise must be a string");
        }
        const answerList = answers === undefined ? null : parseAnswersInput(answers);
        const last = await prisma.chapter.findFirst({
            where: scope,
            orderBy: { order: "desc" },
            select: { order: true },
        });
        const chapter = await prisma.chapter.create({
            data: {
                ...scope,
                title: trimmedTitle,
                content: typeof content === "string" ? content : "",
                exercise: typeof exercise === "string" ? exercise : "",
                ...(answerList && answerList.length > 0
                    ? {
                        answers: answerList,
                        answersGeneratedAt: new Date(),
                    }
                    : {}),
                order: (last?.order ?? -1) + 1,
            },
        });
        res.status(201).json({ chapter });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to create chapter");
    }
}
export async function updateChapter(req, res) {
    try {
        const scope = chapterScope(req);
        const chapterId = param(req, "chapterId");
        await ensureChapterAccess(req, scope);
        const existing = await prisma.chapter.findFirst({
            where: { id: chapterId, ...scope },
        });
        if (!existing) {
            throw notFound("Chapter not found");
        }
        const { title, content, exercise, answers } = req.body;
        const data = {};
        let answersCleared = false;
        if (title !== undefined) {
            const trimmedTitle = typeof title === "string" ? title.trim() : "";
            if (!trimmedTitle) {
                throw badRequest("title is required");
            }
            data.title = trimmedTitle;
        }
        if (content !== undefined) {
            if (typeof content !== "string") {
                throw badRequest("content must be a string");
            }
            data.content = content;
        }
        if (exercise !== undefined) {
            if (typeof exercise !== "string") {
                throw badRequest("exercise must be a string");
            }
            data.exercise = exercise;
        }
        if (answers !== undefined) {
            const answerList = parseAnswersInput(answers);
            data.answers = answerList;
            data.answersStale = false;
            data.answersGeneratedAt = answerList.length > 0 ? new Date() : null;
            answersCleared = answerList.length === 0;
        }
        if (Object.keys(data).length === 0) {
            throw badRequest("No chapter fields to update");
        }
        const hasAnswers = !answersCleared &&
            Array.isArray(existing.answers) &&
            existing.answers.length > 0;
        const contentChanged = typeof content === "string" && content !== existing.content;
        const exerciseChanged = typeof exercise === "string" && exercise !== existing.exercise;
        if (answers === undefined &&
            hasAnswers &&
            (contentChanged || exerciseChanged)) {
            data.answersStale = true;
        }
        const chapter = await prisma.chapter.update({
            where: { id: chapterId },
            data,
        });
        res.json({ chapter });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to update chapter");
    }
}
export async function deleteChapter(req, res) {
    try {
        const scope = chapterScope(req);
        const chapterId = param(req, "chapterId");
        await ensureChapterAccess(req, scope);
        const existing = await prisma.chapter.findFirst({
            where: { id: chapterId, ...scope },
            select: { id: true },
        });
        if (!existing) {
            throw notFound("Chapter not found");
        }
        await prisma.chapter.delete({ where: { id: chapterId } });
        res.json({ ok: true });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to delete chapter");
    }
}
export async function moveChapter(req, res) {
    try {
        const scope = chapterScope(req);
        const chapterId = param(req, "chapterId");
        const { direction } = req.body;
        if (direction !== "up" && direction !== "down") {
            throw badRequest("direction must be 'up' or 'down'");
        }
        await ensureChapterAccess(req, scope);
        const chapters = await prisma.chapter.findMany({
            where: scope,
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        });
        const index = chapters.findIndex((c) => c.id === chapterId);
        if (index === -1) {
            throw notFound("Chapter not found");
        }
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= chapters.length) {
            res.json({ chapters });
            return;
        }
        const reordered = [...chapters];
        const current = reordered[index];
        const target = reordered[targetIndex];
        if (!current || !target) {
            res.json({ chapters });
            return;
        }
        reordered[index] = target;
        reordered[targetIndex] = current;
        // Renumber sequentially so duplicate or gapped positions are normalized.
        await prisma.$transaction(reordered.map((chapter, position) => prisma.chapter.update({
            where: { id: chapter.id },
            data: { order: position },
        })));
        const updated = await prisma.chapter.findMany({
            where: scope,
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        });
        res.json({ chapters: updated });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to reorder chapter");
    }
}
export async function generateChapter(req, res) {
    try {
        const scope = chapterScope(req);
        await ensureChapterAccess(req, scope);
        const files = readUploadedImages(req);
        const effort = readEffort(req);
        assertGenerationRateLimit(scope.schoolId);
        const draft = await generateChapterDraft(files.map((file) => ({
            buffer: file.buffer,
            mimetype: file.mimetype,
            originalname: file.originalname,
        })), effort);
        res.json({ draft });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to generate chapter");
    }
}
export async function generateExercise(req, res) {
    try {
        const scope = chapterScope(req);
        const chapterId = param(req, "chapterId");
        await ensureChapterAccess(req, scope);
        const chapter = await prisma.chapter.findFirst({
            where: { id: chapterId, ...scope },
            select: { title: true, content: true },
        });
        if (!chapter) {
            throw notFound("Chapter not found");
        }
        if (!chapter.content.trim()) {
            throw badRequest("Add chapter content before generating an exercise.");
        }
        const files = readUploadedImages(req);
        const effort = readEffort(req);
        assertGenerationRateLimit(scope.schoolId);
        const exercise = await generateExerciseDraft({ title: chapter.title, content: chapter.content }, files.map((file) => ({
            buffer: file.buffer,
            mimetype: file.mimetype,
            originalname: file.originalname,
        })), effort);
        res.json({ draft: { exercise } });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to generate exercise");
    }
}
export async function generateAnswers(req, res) {
    try {
        const scope = chapterScope(req);
        const chapterId = param(req, "chapterId");
        await ensureChapterAccess(req, scope);
        const chapter = await prisma.chapter.findFirst({
            where: { id: chapterId, ...scope },
            select: { title: true, content: true, exercise: true },
        });
        if (!chapter) {
            throw notFound("Chapter not found");
        }
        if (!chapter.content.trim()) {
            throw badRequest("Add chapter content before generating answers.");
        }
        if (!chapter.exercise.trim()) {
            throw badRequest("Add an exercise before generating answers.");
        }
        const effort = readEffort(req);
        assertGenerationRateLimit(scope.schoolId);
        const answers = await generateAnswersDraft({
            title: chapter.title,
            content: chapter.content,
            exercise: chapter.exercise,
        }, effort);
        const updated = await prisma.chapter.update({
            where: { id: chapterId },
            data: {
                answers: answers,
                answersStale: false,
                answersGeneratedAt: new Date(),
            },
        });
        res.json({ chapter: updated, answers });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to generate answers");
    }
}
//# sourceMappingURL=chapter.controller.js.map