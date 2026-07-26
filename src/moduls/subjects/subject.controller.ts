import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";

export async function listSubjects(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const subjects = await prisma.subject.findMany({
      where: { schoolId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { classes: true } },
      },
    });
    res.json({ subjects });
  } catch (error) {
    handleControllerError(res, error, "Failed to list subjects");
  }
}

export async function createSubject(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const { name } = req.body as { name?: string };
    const trimmed = typeof name === "string" ? name.trim() : "";

    if (!trimmed) {
      throw badRequest("name is required");
    }

    const existing = await prisma.subject.findFirst({
      where: { schoolId, name: trimmed },
    });
    if (existing) {
      throw conflict("A subject with this name already exists");
    }

    const subject = await prisma.subject.create({
      data: { schoolId, name: trimmed },
    });

    res.status(201).json({ subject });
  } catch (error) {
    handleControllerError(res, error, "Failed to create subject");
  }
}

export async function updateSubject(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");
    const { name } = req.body as { name?: string };
    const trimmed = typeof name === "string" ? name.trim() : "";

    if (!trimmed) {
      throw badRequest("name is required");
    }

    const existing = await prisma.subject.findFirst({
      where: { id, schoolId },
    });
    if (!existing) {
      throw notFound("Subject not found");
    }

    const duplicate = await prisma.subject.findFirst({
      where: { schoolId, name: trimmed, NOT: { id } },
    });
    if (duplicate) {
      throw conflict("A subject with this name already exists");
    }

    const subject = await prisma.subject.update({
      where: { id },
      data: { name: trimmed },
    });

    res.json({ subject });
  } catch (error) {
    handleControllerError(res, error, "Failed to update subject");
  }
}

export async function deleteSubject(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");

    const existing = await prisma.subject.findFirst({
      where: { id, schoolId },
    });
    if (!existing) {
      throw notFound("Subject not found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.classSubject.deleteMany({ where: { subjectId: id, schoolId } });
      await tx.subject.delete({ where: { id } });
    });

    res.json({ ok: true });
  } catch (error) {
    handleControllerError(res, error, "Failed to delete subject");
  }
}
