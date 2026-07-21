import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";
import { toUtcDay, utcDayKey, utcMonthRange } from "../../lib/dates.js";
import { isUtcSunday } from "../../lib/holidays.js";

function parseYearMonth(req: Request): { year: number; month: number } {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw badRequest("year and month (1-12) are required");
  }
  return { year, month };
}

export async function listHolidays(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const { year, month } = parseYearMonth(req);
    const { start, end } = utcMonthRange(year, month);

    const holidays = await prisma.schoolHoliday.findMany({
      where: {
        schoolId,
        date: { gte: start, lte: end },
      },
      orderBy: { date: "asc" },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({
      year,
      month,
      holidays: holidays.map((h) => ({
        id: h.id,
        date: utcDayKey(h.date),
        name: h.name,
        notes: h.notes,
        createdBy: h.createdBy,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to list holidays");
  }
}

export async function createHoliday(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const auth = getAuthUser(req);
    const { date: dateRaw, name, notes } = req.body as {
      date?: string;
      name?: string | null;
      notes?: string | null;
    };

    if (!dateRaw || typeof dateRaw !== "string") {
      throw badRequest("date is required (YYYY-MM-DD)");
    }

    let date: Date;
    try {
      date = toUtcDay(dateRaw);
    } catch {
      throw badRequest("Invalid date");
    }

    if (isUtcSunday(date)) {
      throw badRequest(
        "Sundays are always holidays and do not need to be declared",
      );
    }

    const existing = await prisma.schoolHoliday.findUnique({
      where: {
        schoolId_date: { schoolId, date },
      },
    });
    if (existing) {
      throw conflict("A holiday is already declared for this date");
    }

    const holiday = await prisma.schoolHoliday.create({
      data: {
        schoolId,
        date,
        name: name?.trim() || null,
        notes: notes?.trim() || null,
        createdById: auth.userId,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json({
      holiday: {
        id: holiday.id,
        date: utcDayKey(holiday.date),
        name: holiday.name,
        notes: holiday.notes,
        createdBy: holiday.createdBy,
        createdAt: holiday.createdAt.toISOString(),
        updatedAt: holiday.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to create holiday");
  }
}

export async function deleteHoliday(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");

    const existing = await prisma.schoolHoliday.findFirst({
      where: { id, schoolId },
    });
    if (!existing) {
      throw notFound("Holiday not found");
    }

    await prisma.schoolHoliday.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    handleControllerError(res, error, "Failed to delete holiday");
  }
}
