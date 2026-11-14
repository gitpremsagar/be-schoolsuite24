import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";

async function ensureClassSubject(
  schoolId: string,
  classId: string,
  subjectId: string,
) {
  const link = await prisma.classSubject.findFirst({
    where: { schoolId, classId, subjectId },
    select: { id: true },
  });
  if (!link) {
    throw notFound("Subject is not assigned to this class");
  }
}

function chapterScope(req: Request) {
  return {
    schoolId: requireSchoolId(req),
    classId: param(req, "id"),
    subjectId: param(req, "subjectId"),
  };
}

export async function listChapters(req: Request, res: Response) {
  try {
    const scope = chapterScope(req);
    await ensureClassSubject(scope.schoolId, scope.classId, scope.subjectId);

    const chapters = await prisma.chapter.findMany({
      where: scope,
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    res.json({ chapters });
  } catch (error) {
    handleControllerError(res, error, "Failed to list chapters");
  }
}

export async function createChapter(req: Request, res: Response) {
  try {
    const scope = chapterScope(req);
    await ensureClassSubject(scope.schoolId, scope.classId, scope.subjectId);

    const { title, content } = req.body as {
      title?: unknown;
      content?: unknown;
    };
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    if (!trimmedTitle) {
      throw badRequest("title is required");
    }
    if (content !== undefined && typeof content !== "string") {
      throw badRequest("content must be a string");
    }

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
        order: (last?.order ?? -1) + 1,
      },
    });

    res.status(201).json({ chapter });
  } catch (error) {
    handleControllerError(res, error, "Failed to create chapter");
  }
}

export async function updateChapter(req: Request, res: Response) {
  try {
    const scope = chapterScope(req);
    const chapterId = param(req, "chapterId");
    await ensureClassSubject(scope.schoolId, scope.classId, scope.subjectId);

    const existing = await prisma.chapter.findFirst({
      where: { id: chapterId, ...scope },
    });
    if (!existing) {
      throw notFound("Chapter not found");
    }

    const { title, content } = req.body as {
      title?: unknown;
      content?: unknown;
    };

    const data: { title?: string; content?: string } = {};
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
    if (Object.keys(data).length === 0) {
      throw badRequest("No chapter fields to update");
    }

    const chapter = await prisma.chapter.update({
      where: { id: chapterId },
      data,
    });

    res.json({ chapter });
  } catch (error) {
    handleControllerError(res, error, "Failed to update chapter");
  }
}

export async function deleteChapter(req: Request, res: Response) {
  try {
    const scope = chapterScope(req);
    const chapterId = param(req, "chapterId");
    await ensureClassSubject(scope.schoolId, scope.classId, scope.subjectId);

    const existing = await prisma.chapter.findFirst({
      where: { id: chapterId, ...scope },
      select: { id: true },
    });
    if (!existing) {
      throw notFound("Chapter not found");
    }

    await prisma.chapter.delete({ where: { id: chapterId } });
    res.json({ ok: true });
  } catch (error) {
    handleControllerError(res, error, "Failed to delete chapter");
  }
}

export async function moveChapter(req: Request, res: Response) {
  try {
    const scope = chapterScope(req);
    const chapterId = param(req, "chapterId");
    const { direction } = req.body as { direction?: unknown };
    if (direction !== "up" && direction !== "down") {
      throw badRequest("direction must be 'up' or 'down'");
    }

    await ensureClassSubject(scope.schoolId, scope.classId, scope.subjectId);

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
    await prisma.$transaction(
      reordered.map((chapter, position) =>
        prisma.chapter.update({
          where: { id: chapter.id },
          data: { order: position },
        }),
      ),
    );

    const updated = await prisma.chapter.findMany({
      where: scope,
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    res.json({ chapters: updated });
  } catch (error) {
    handleControllerError(res, error, "Failed to reorder chapter");
  }
}
