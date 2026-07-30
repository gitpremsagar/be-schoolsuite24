import { prisma } from "../../lib/prisma.js";
import { classLevelSortIndex, formatClassLabel, } from "../../lib/class-levels.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
const auditUserSelect = {
    id: true,
    name: true,
    email: true,
};
const classSelect = {
    id: true,
    classLevel: true,
    section: true,
};
const subjectSelect = {
    id: true,
    name: true,
};
const examinationInclude = {
    classes: {
        include: {
            class: { select: classSelect },
        },
    },
    papers: {
        include: {
            class: { select: classSelect },
            subject: { select: subjectSelect },
        },
    },
    academicYear: {
        select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            isCurrent: true,
        },
    },
    createdBy: { select: auditUserSelect },
    updatedBy: { select: auditUserSelect },
};
function paramId(value, label = "id") {
    const id = Array.isArray(value) ? value[0] : value;
    if (!id || typeof id !== "string") {
        throw badRequest(`Examination ${label} is required`);
    }
    return id;
}
function parseRequiredDate(value, field) {
    if (typeof value !== "string" || !value.trim()) {
        throw badRequest(`${field} is required`);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        throw badRequest(`Invalid ${field}`);
    return d;
}
function parseOptionalDate(value, field) {
    if (value === undefined)
        return undefined;
    if (value === null || value === "")
        return undefined;
    if (typeof value !== "string") {
        throw badRequest(`${field} must be a date string`);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        throw badRequest(`Invalid ${field}`);
    return d;
}
async function resolveAcademicYear(schoolId, academicYearId) {
    if (academicYearId) {
        const year = await prisma.academicYear.findFirst({
            where: { id: academicYearId, schoolId },
        });
        if (!year)
            throw notFound("Academic year not found");
        return year;
    }
    const current = await prisma.academicYear.findFirst({
        where: { schoolId, isCurrent: true },
    });
    if (!current)
        throw badRequest("No current academic year set");
    return current;
}
function serializeClass(c) {
    return {
        id: c.id,
        classLevel: c.classLevel,
        section: c.section,
        label: formatClassLabel(c.classLevel, c.section),
    };
}
function serializeExamination(exam, counts) {
    const classes = exam.classes
        .map((ec) => ({
        id: ec.id,
        classId: ec.classId,
        classLevel: ec.class.classLevel,
        section: ec.class.section,
        label: formatClassLabel(ec.class.classLevel, ec.class.section),
    }))
        .sort((a, b) => classLevelSortIndex(a.classLevel) - classLevelSortIndex(b.classLevel) ||
        (a.section ?? "").localeCompare(b.section ?? ""));
    const papers = exam.papers
        .map((p) => ({
        id: p.id,
        classId: p.classId,
        subjectId: p.subjectId,
        maxMarks: p.maxMarks,
        class: serializeClass(p.class),
        subject: p.subject,
    }))
        .sort((a, b) => classLevelSortIndex(a.class.classLevel) -
        classLevelSortIndex(b.class.classLevel) ||
        (a.class.section ?? "").localeCompare(b.class.section ?? "") ||
        a.subject.name.localeCompare(b.subject.name));
    return {
        id: exam.id,
        schoolId: exam.schoolId,
        academicYearId: exam.academicYearId,
        name: exam.name,
        description: exam.description,
        examDate: exam.examDate,
        scope: exam.scope,
        createdById: exam.createdById,
        updatedById: exam.updatedById,
        createdAt: exam.createdAt,
        updatedAt: exam.updatedAt,
        academicYear: exam.academicYear,
        createdBy: exam.createdBy,
        updatedBy: exam.updatedBy,
        classes,
        papers,
        markSheetCount: counts?.markSheetCount ?? 0,
        publishedCount: counts?.publishedCount ?? 0,
        markedCount: counts?.markedCount ?? 0,
    };
}
async function loadExaminationOrThrow(schoolId, id) {
    const exam = await prisma.examination.findFirst({
        where: { id, schoolId },
        include: examinationInclude,
    });
    if (!exam)
        throw notFound("Examination not found");
    return exam;
}
async function getMarkSheetCounts(examinationIds) {
    if (examinationIds.length === 0) {
        return new Map();
    }
    const sheets = await prisma.markSheet.findMany({
        where: { examinationId: { in: examinationIds } },
        select: {
            examinationId: true,
            isPublished: true,
            marksObtained: true,
        },
    });
    const map = new Map();
    for (const id of examinationIds) {
        map.set(id, { markSheetCount: 0, publishedCount: 0, markedCount: 0 });
    }
    for (const s of sheets) {
        const entry = map.get(s.examinationId);
        entry.markSheetCount += 1;
        if (s.isPublished)
            entry.publishedCount += 1;
        if (s.marksObtained != null)
            entry.markedCount += 1;
    }
    return map;
}
async function getTeacherAssignments(schoolId, userId) {
    const staff = await prisma.staffProfile.findFirst({
        where: { schoolId, userId, staffType: "TEACHER" },
        select: { id: true },
    });
    if (!staff)
        throw forbidden("Teacher profile required");
    const assignments = await prisma.classSubject.findMany({
        where: { schoolId, staffProfileId: staff.id },
        select: { classId: true, subjectId: true },
    });
    return {
        staffProfileId: staff.id,
        assignments,
        keys: new Set(assignments.map((a) => `${a.classId}:${a.subjectId}`)),
    };
}
function parsePapers(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest("papers are required");
    }
    const papers = [];
    const seen = new Set();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            throw badRequest("Each paper must be an object");
        }
        const row = entry;
        const classId = typeof row.classId === "string" ? row.classId : "";
        const subjectId = typeof row.subjectId === "string" ? row.subjectId : "";
        const maxMarks = typeof row.maxMarks === "number"
            ? row.maxMarks
            : typeof row.maxMarks === "string"
                ? Number(row.maxMarks)
                : NaN;
        if (!classId || !subjectId) {
            throw badRequest("Each paper requires classId and subjectId");
        }
        if (!Number.isFinite(maxMarks) || maxMarks <= 0) {
            throw badRequest("Each paper requires a positive maxMarks");
        }
        const key = `${classId}:${subjectId}`;
        if (seen.has(key)) {
            throw badRequest("Duplicate class/subject paper in request");
        }
        seen.add(key);
        papers.push({ classId, subjectId, maxMarks });
    }
    return papers;
}
export async function createExamination(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const { academicYearId, name, description, examDate, scope, classIds, papers: papersRaw, } = req.body;
        const trimmedName = typeof name === "string" ? name.trim() : "";
        if (!trimmedName)
            throw badRequest("name is required");
        const year = await resolveAcademicYear(schoolId, academicYearId);
        const parsedExamDate = parseRequiredDate(examDate, "examDate");
        const papers = parsePapers(papersRaw);
        let resolvedScope = scope === "SCHOOL" || scope === "CLASSES" ? scope : "CLASSES";
        let teacherKeys = null;
        if (auth.role === "TEACHER") {
            const teacher = await getTeacherAssignments(schoolId, auth.userId);
            teacherKeys = teacher.keys;
            if (teacherKeys.size === 0) {
                throw badRequest("You have no assigned class subjects");
            }
            resolvedScope = "CLASSES";
            for (const p of papers) {
                if (!teacherKeys.has(`${p.classId}:${p.subjectId}`)) {
                    throw forbidden("You can only create exams for your assigned class subjects");
                }
            }
        }
        const paperClassIds = [...new Set(papers.map((p) => p.classId))];
        let examClassIds = [];
        if (resolvedScope === "SCHOOL") {
            const allClasses = await prisma.class.findMany({
                where: { schoolId, academicYearId: year.id },
                select: { id: true },
            });
            const allIds = new Set(allClasses.map((c) => c.id));
            for (const classId of paperClassIds) {
                if (!allIds.has(classId)) {
                    throw badRequest("One or more paper classes are invalid for this academic year");
                }
            }
            examClassIds = paperClassIds;
        }
        else {
            if (Array.isArray(classIds) && classIds.length > 0) {
                examClassIds = [
                    ...new Set(classIds.filter((id) => typeof id === "string")),
                ];
            }
            else {
                examClassIds = paperClassIds;
            }
            if (examClassIds.length === 0) {
                throw badRequest("classIds are required when scope is CLASSES");
            }
            for (const classId of paperClassIds) {
                if (!examClassIds.includes(classId)) {
                    throw badRequest("All paper classIds must be included in classIds");
                }
            }
            const classes = await prisma.class.findMany({
                where: {
                    id: { in: examClassIds },
                    schoolId,
                    academicYearId: year.id,
                },
                select: { id: true },
            });
            if (classes.length !== examClassIds.length) {
                throw badRequest("One or more classes are invalid for this school/academic year");
            }
        }
        const classSubjects = await prisma.classSubject.findMany({
            where: {
                schoolId,
                OR: papers.map((p) => ({
                    classId: p.classId,
                    subjectId: p.subjectId,
                })),
            },
            select: { classId: true, subjectId: true },
        });
        const validPairs = new Set(classSubjects.map((cs) => `${cs.classId}:${cs.subjectId}`));
        for (const p of papers) {
            if (!validPairs.has(`${p.classId}:${p.subjectId}`)) {
                throw badRequest("Subject is not assigned to the selected class");
            }
        }
        const enrollments = await prisma.enrollment.findMany({
            where: {
                schoolId,
                academicYearId: year.id,
                classId: { in: paperClassIds },
                isActive: true,
                studentProfile: { isCurrentlyStudying: true },
            },
            select: {
                classId: true,
                studentProfileId: true,
            },
        });
        const studentsByClass = new Map();
        for (const e of enrollments) {
            const list = studentsByClass.get(e.classId) ?? [];
            list.push(e.studentProfileId);
            studentsByClass.set(e.classId, list);
        }
        const created = await prisma.$transaction(async (tx) => {
            const exam = await tx.examination.create({
                data: {
                    schoolId,
                    academicYearId: year.id,
                    name: trimmedName,
                    description: typeof description === "string" && description.trim()
                        ? description.trim()
                        : null,
                    examDate: parsedExamDate,
                    scope: resolvedScope,
                    createdById: auth.userId,
                    updatedById: auth.userId,
                    classes: {
                        create: examClassIds.map((classId) => ({
                            schoolId,
                            classId,
                        })),
                    },
                    papers: {
                        create: papers.map((p) => ({
                            schoolId,
                            classId: p.classId,
                            subjectId: p.subjectId,
                            maxMarks: p.maxMarks,
                        })),
                    },
                },
                include: {
                    papers: true,
                },
            });
            const markSheetRows = [];
            for (const paper of exam.papers) {
                const studentIds = studentsByClass.get(paper.classId) ?? [];
                for (const studentProfileId of studentIds) {
                    markSheetRows.push({
                        schoolId,
                        examinationId: exam.id,
                        paperId: paper.id,
                        classId: paper.classId,
                        subjectId: paper.subjectId,
                        studentProfileId,
                    });
                }
            }
            if (markSheetRows.length > 0) {
                await tx.markSheet.createMany({ data: markSheetRows });
            }
            return exam.id;
        });
        const exam = await loadExaminationOrThrow(schoolId, created);
        const counts = await getMarkSheetCounts([exam.id]);
        res.status(201).json({
            examination: serializeExamination(exam, counts.get(exam.id)),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to create examination");
    }
}
export async function listExaminations(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const academicYearId = typeof req.query.academicYearId === "string"
            ? req.query.academicYearId
            : undefined;
        let where = { schoolId };
        if (academicYearId) {
            where.academicYearId = academicYearId;
        }
        let teacherKeys = null;
        if (auth.role === "TEACHER") {
            const teacher = await getTeacherAssignments(schoolId, auth.userId);
            teacherKeys = teacher.keys;
            if (teacher.assignments.length === 0) {
                res.json({ examinations: [] });
                return;
            }
            where = {
                ...where,
                OR: teacher.assignments.map((a) => ({
                    papers: {
                        some: { classId: a.classId, subjectId: a.subjectId },
                    },
                })),
            };
        }
        const exams = await prisma.examination.findMany({
            where,
            include: examinationInclude,
            orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
        });
        const filtered = teacherKeys == null
            ? exams
            : exams.map((exam) => ({
                ...exam,
                papers: exam.papers.filter((p) => teacherKeys.has(`${p.classId}:${p.subjectId}`)),
            }));
        const counts = await getMarkSheetCounts(filtered.map((e) => e.id));
        res.json({
            examinations: filtered.map((e) => serializeExamination(e, counts.get(e.id))),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list examinations");
    }
}
export async function getExamination(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const id = paramId(req.params.id);
        const exam = await loadExaminationOrThrow(schoolId, id);
        if (auth.role === "TEACHER") {
            const teacher = await getTeacherAssignments(schoolId, auth.userId);
            const allowedPapers = exam.papers.filter((p) => teacher.keys.has(`${p.classId}:${p.subjectId}`));
            if (allowedPapers.length === 0) {
                throw forbidden("You do not have access to this examination");
            }
            const filtered = { ...exam, papers: allowedPapers };
            const counts = await getMarkSheetCounts([exam.id]);
            res.json({
                examination: serializeExamination(filtered, counts.get(exam.id)),
            });
            return;
        }
        const counts = await getMarkSheetCounts([exam.id]);
        res.json({
            examination: serializeExamination(exam, counts.get(exam.id)),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to get examination");
    }
}
export async function updateExamination(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const id = paramId(req.params.id);
        const exam = await prisma.examination.findFirst({
            where: { id, schoolId },
            include: {
                papers: true,
                classes: true,
            },
        });
        if (!exam)
            throw notFound("Examination not found");
        if (auth.role === "TEACHER" && exam.createdById !== auth.userId) {
            throw forbidden("Teachers can only update examinations they created");
        }
        const { name, description, examDate, papers: papersRaw, scope, classIds, } = req.body;
        const meta = { updatedById: auth.userId };
        if (name !== undefined) {
            const trimmed = typeof name === "string" ? name.trim() : "";
            if (!trimmed)
                throw badRequest("name cannot be empty");
            meta.name = trimmed;
        }
        if (description !== undefined) {
            meta.description =
                typeof description === "string" && description.trim()
                    ? description.trim()
                    : null;
        }
        if (examDate !== undefined) {
            const parsed = parseOptionalDate(examDate, "examDate");
            if (!parsed)
                throw badRequest("examDate is required");
            meta.examDate = parsed;
        }
        const syncPapers = papersRaw !== undefined;
        let nextPapers = null;
        if (syncPapers) {
            nextPapers = parsePapers(papersRaw);
            let teacherKeys = null;
            if (auth.role === "TEACHER") {
                const teacher = await getTeacherAssignments(schoolId, auth.userId);
                teacherKeys = teacher.keys;
                for (const p of nextPapers) {
                    if (!teacherKeys.has(`${p.classId}:${p.subjectId}`)) {
                        throw forbidden("You can only assign your assigned class subjects");
                    }
                }
            }
            const paperClassIds = [...new Set(nextPapers.map((p) => p.classId))];
            let resolvedScope = exam.scope;
            if (scope === "SCHOOL" || scope === "CLASSES") {
                if (auth.role === "TEACHER") {
                    resolvedScope = "CLASSES";
                }
                else {
                    resolvedScope = scope;
                }
            }
            else if (auth.role === "TEACHER") {
                resolvedScope = "CLASSES";
            }
            meta.scope = resolvedScope;
            if (resolvedScope === "SCHOOL") {
                const allClasses = await prisma.class.findMany({
                    where: { schoolId, academicYearId: exam.academicYearId },
                    select: { id: true },
                });
                const allIds = new Set(allClasses.map((c) => c.id));
                for (const classId of paperClassIds) {
                    if (!allIds.has(classId)) {
                        throw badRequest("One or more paper classes are invalid for this academic year");
                    }
                }
            }
            else {
                let examClassIds;
                if (Array.isArray(classIds) && classIds.length > 0) {
                    examClassIds = [
                        ...new Set(classIds.filter((id) => typeof id === "string")),
                    ];
                }
                else {
                    examClassIds = paperClassIds;
                }
                for (const classId of paperClassIds) {
                    if (!examClassIds.includes(classId)) {
                        throw badRequest("All paper classIds must be included in classIds");
                    }
                }
                const classes = await prisma.class.findMany({
                    where: {
                        id: { in: examClassIds },
                        schoolId,
                        academicYearId: exam.academicYearId,
                    },
                    select: { id: true },
                });
                if (classes.length !== examClassIds.length) {
                    throw badRequest("One or more classes are invalid for this school/academic year");
                }
            }
            const classSubjects = await prisma.classSubject.findMany({
                where: {
                    schoolId,
                    OR: nextPapers.map((p) => ({
                        classId: p.classId,
                        subjectId: p.subjectId,
                    })),
                },
                select: { classId: true, subjectId: true },
            });
            const validPairs = new Set(classSubjects.map((cs) => `${cs.classId}:${cs.subjectId}`));
            for (const p of nextPapers) {
                if (!validPairs.has(`${p.classId}:${p.subjectId}`)) {
                    throw badRequest("Subject is not assigned to the selected class");
                }
            }
        }
        await prisma.$transaction(async (tx) => {
            await tx.examination.update({
                where: { id: exam.id },
                data: meta,
            });
            if (!nextPapers)
                return;
            const existingByKey = new Map(exam.papers.map((p) => [
                `${p.classId}:${p.subjectId}`,
                p,
            ]));
            const nextByKey = new Map(nextPapers.map((p) => [`${p.classId}:${p.subjectId}`, p]));
            // Remove papers no longer selected
            const toRemove = exam.papers.filter((p) => !nextByKey.has(`${p.classId}:${p.subjectId}`));
            if (toRemove.length > 0) {
                const removeIds = toRemove.map((p) => p.id);
                await tx.markSheet.deleteMany({
                    where: { paperId: { in: removeIds } },
                });
                await tx.examinationPaper.deleteMany({
                    where: { id: { in: removeIds } },
                });
            }
            // Update maxMarks on existing papers
            for (const p of exam.papers) {
                const key = `${p.classId}:${p.subjectId}`;
                const next = nextByKey.get(key);
                if (!next)
                    continue;
                if (next.maxMarks === p.maxMarks)
                    continue;
                const over = await tx.markSheet.count({
                    where: {
                        paperId: p.id,
                        marksObtained: { gt: next.maxMarks },
                    },
                });
                if (over > 0) {
                    throw badRequest(`Cannot set max marks to ${next.maxMarks}: some students already have higher marks`);
                }
                await tx.examinationPaper.update({
                    where: { id: p.id },
                    data: { maxMarks: next.maxMarks },
                });
            }
            // Add new papers + mark sheets
            const toAdd = nextPapers.filter((p) => !existingByKey.has(`${p.classId}:${p.subjectId}`));
            if (toAdd.length > 0) {
                const addClassIds = [...new Set(toAdd.map((p) => p.classId))];
                const enrollments = await tx.enrollment.findMany({
                    where: {
                        schoolId,
                        academicYearId: exam.academicYearId,
                        classId: { in: addClassIds },
                        isActive: true,
                        studentProfile: { isCurrentlyStudying: true },
                    },
                    select: { classId: true, studentProfileId: true },
                });
                const studentsByClass = new Map();
                for (const e of enrollments) {
                    const list = studentsByClass.get(e.classId) ?? [];
                    list.push(e.studentProfileId);
                    studentsByClass.set(e.classId, list);
                }
                for (const p of toAdd) {
                    const paper = await tx.examinationPaper.create({
                        data: {
                            schoolId,
                            examinationId: exam.id,
                            classId: p.classId,
                            subjectId: p.subjectId,
                            maxMarks: p.maxMarks,
                        },
                    });
                    const studentIds = studentsByClass.get(p.classId) ?? [];
                    if (studentIds.length > 0) {
                        await tx.markSheet.createMany({
                            data: studentIds.map((studentProfileId) => ({
                                schoolId,
                                examinationId: exam.id,
                                paperId: paper.id,
                                classId: p.classId,
                                subjectId: p.subjectId,
                                studentProfileId,
                            })),
                        });
                    }
                }
            }
            // Sync ExaminationClass to match papers
            const desiredClassIds = [...new Set(nextPapers.map((p) => p.classId))];
            const existingClassIds = new Set(exam.classes.map((c) => c.classId));
            const classIdsToAdd = desiredClassIds.filter((cid) => !existingClassIds.has(cid));
            const classIdsToRemove = [...existingClassIds].filter((cid) => !desiredClassIds.includes(cid));
            if (classIdsToRemove.length > 0) {
                await tx.examinationClass.deleteMany({
                    where: {
                        examinationId: exam.id,
                        classId: { in: classIdsToRemove },
                    },
                });
            }
            if (classIdsToAdd.length > 0) {
                await tx.examinationClass.createMany({
                    data: classIdsToAdd.map((classId) => ({
                        schoolId,
                        examinationId: exam.id,
                        classId,
                    })),
                });
            }
        });
        const updated = await loadExaminationOrThrow(schoolId, exam.id);
        const counts = await getMarkSheetCounts([updated.id]);
        res.json({
            examination: serializeExamination(updated, counts.get(updated.id)),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to update examination");
    }
}
export async function deleteExamination(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const id = paramId(req.params.id);
        const exam = await prisma.examination.findFirst({
            where: { id, schoolId },
            select: { id: true, createdById: true },
        });
        if (!exam)
            throw notFound("Examination not found");
        if (auth.role === "TEACHER" && exam.createdById !== auth.userId) {
            throw forbidden("Teachers can only delete examinations they created");
        }
        await prisma.$transaction([
            prisma.markSheet.deleteMany({ where: { examinationId: exam.id } }),
            prisma.examinationPaper.deleteMany({ where: { examinationId: exam.id } }),
            prisma.examinationClass.deleteMany({ where: { examinationId: exam.id } }),
            prisma.examination.delete({ where: { id: exam.id } }),
        ]);
        res.json({ ok: true });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to delete examination");
    }
}
export async function listMarkSheets(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const examinationId = paramId(req.params.id);
        const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
        const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : undefined;
        const exam = await prisma.examination.findFirst({
            where: { id: examinationId, schoolId },
            select: { id: true },
        });
        if (!exam)
            throw notFound("Examination not found");
        let teacherKeys = null;
        if (auth.role === "TEACHER") {
            const teacher = await getTeacherAssignments(schoolId, auth.userId);
            teacherKeys = teacher.keys;
            if (classId && subjectId && !teacherKeys.has(`${classId}:${subjectId}`)) {
                throw forbidden("You do not have access to this class subject");
            }
        }
        const sheets = await prisma.markSheet.findMany({
            where: {
                schoolId,
                examinationId,
                ...(classId ? { classId } : {}),
                ...(subjectId ? { subjectId } : {}),
            },
            include: {
                studentProfile: {
                    select: {
                        id: true,
                        admissionNumber: true,
                        rollNumber: true,
                        user: { select: { id: true, name: true, email: true } },
                    },
                },
                subject: { select: subjectSelect },
                class: { select: classSelect },
                paper: { select: { id: true, maxMarks: true } },
            },
            orderBy: [{ classId: "asc" }, { subjectId: "asc" }],
        });
        const filtered = teacherKeys == null
            ? sheets
            : sheets.filter((s) => teacherKeys.has(`${s.classId}:${s.subjectId}`));
        const sorted = [...filtered].sort((a, b) => {
            const classCmp = classLevelSortIndex(a.class.classLevel) -
                classLevelSortIndex(b.class.classLevel) ||
                (a.class.section ?? "").localeCompare(b.class.section ?? "");
            if (classCmp !== 0)
                return classCmp;
            const subCmp = a.subject.name.localeCompare(b.subject.name);
            if (subCmp !== 0)
                return subCmp;
            const rollA = a.studentProfile.rollNumber ?? "";
            const rollB = b.studentProfile.rollNumber ?? "";
            if (rollA && rollB)
                return rollA.localeCompare(rollB, undefined, { numeric: true });
            return a.studentProfile.user.name.localeCompare(b.studentProfile.user.name);
        });
        res.json({
            markSheets: sorted.map((s) => ({
                id: s.id,
                examinationId: s.examinationId,
                paperId: s.paperId,
                classId: s.classId,
                subjectId: s.subjectId,
                studentProfileId: s.studentProfileId,
                marksObtained: s.marksObtained,
                maxMarks: s.paper.maxMarks,
                isPublished: s.isPublished,
                publishedAt: s.publishedAt,
                student: {
                    id: s.studentProfile.id,
                    name: s.studentProfile.user.name,
                    email: s.studentProfile.user.email,
                    admissionNumber: s.studentProfile.admissionNumber,
                    rollNumber: s.studentProfile.rollNumber,
                },
                class: serializeClass(s.class),
                subject: s.subject,
            })),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list mark sheets");
    }
}
export async function saveMarkSheets(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const examinationId = paramId(req.params.id);
        const { records } = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            throw badRequest("records are required");
        }
        const exam = await prisma.examination.findFirst({
            where: { id: examinationId, schoolId },
            include: {
                papers: { select: { id: true, classId: true, subjectId: true, maxMarks: true } },
            },
        });
        if (!exam)
            throw notFound("Examination not found");
        let teacherKeys = null;
        if (auth.role === "TEACHER") {
            const teacher = await getTeacherAssignments(schoolId, auth.userId);
            teacherKeys = teacher.keys;
        }
        const paperById = new Map(exam.papers.map((p) => [p.id, p]));
        const ids = records
            .map((r) => (typeof r.id === "string" ? r.id : ""))
            .filter(Boolean);
        if (ids.length !== records.length) {
            throw badRequest("Each record requires an id");
        }
        const existing = await prisma.markSheet.findMany({
            where: {
                id: { in: ids },
                schoolId,
                examinationId,
            },
            select: {
                id: true,
                paperId: true,
                classId: true,
                subjectId: true,
            },
        });
        if (existing.length !== ids.length) {
            throw badRequest("One or more mark sheets are invalid");
        }
        const existingById = new Map(existing.map((e) => [e.id, e]));
        for (const record of records) {
            const sheet = existingById.get(record.id);
            if (teacherKeys &&
                !teacherKeys.has(`${sheet.classId}:${sheet.subjectId}`)) {
                throw forbidden("You can only mark your assigned class subjects");
            }
            const paper = paperById.get(sheet.paperId);
            if (!paper)
                throw badRequest("Mark sheet paper not found");
            if (record.marksObtained === null || record.marksObtained === undefined) {
                continue;
            }
            if (typeof record.marksObtained !== "number" ||
                Number.isNaN(record.marksObtained)) {
                throw badRequest("marksObtained must be a number or null");
            }
            if (record.marksObtained < 0 || record.marksObtained > paper.maxMarks) {
                throw badRequest(`marksObtained must be between 0 and ${paper.maxMarks}`);
            }
        }
        // MongoDB Prisma hangs on large single $transaction arrays; update in chunks.
        const CHUNK = 40;
        for (let i = 0; i < records.length; i += CHUNK) {
            const chunk = records.slice(i, i + CHUNK);
            await Promise.all(chunk.map((record) => {
                const marksObtained = record.marksObtained === null || record.marksObtained === undefined
                    ? null
                    : record.marksObtained;
                return prisma.markSheet.update({
                    where: { id: record.id },
                    data: {
                        marksObtained,
                        markedById: auth.userId,
                    },
                });
            }));
        }
        res.json({ ok: true, updated: records.length });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to save mark sheets");
    }
}
export async function publishMarkSheets(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const examinationId = paramId(req.params.id);
        const { publish = true, ids, classId, subjectId, } = req.body;
        const exam = await prisma.examination.findFirst({
            where: { id: examinationId, schoolId },
            select: { id: true },
        });
        if (!exam)
            throw notFound("Examination not found");
        let teacherKeys = null;
        if (auth.role === "TEACHER") {
            const teacher = await getTeacherAssignments(schoolId, auth.userId);
            teacherKeys = teacher.keys;
            if (classId && subjectId && !teacherKeys.has(`${classId}:${subjectId}`)) {
                throw forbidden("You do not have access to this class subject");
            }
            if (classId && !subjectId) {
                const hasClassAccess = [...teacherKeys].some((key) => key.startsWith(`${classId}:`));
                if (!hasClassAccess) {
                    throw forbidden("You do not have access to this class");
                }
            }
        }
        const whereBase = {
            schoolId,
            examinationId,
        };
        if (Array.isArray(ids) && ids.length > 0) {
            whereBase.id = { in: ids.filter((id) => typeof id === "string") };
        }
        else if (classId && subjectId) {
            whereBase.classId = classId;
            whereBase.subjectId = subjectId;
        }
        else if (classId) {
            whereBase.classId = classId;
        }
        else {
            throw badRequest("Provide ids or classId (optionally with subjectId)");
        }
        const targets = await prisma.markSheet.findMany({
            where: whereBase,
            select: { id: true, classId: true, subjectId: true },
        });
        const allowed = teacherKeys == null
            ? targets
            : targets.filter((t) => teacherKeys.has(`${t.classId}:${t.subjectId}`));
        if (allowed.length === 0) {
            throw badRequest("No mark sheets matched the publish criteria");
        }
        const result = await prisma.markSheet.updateMany({
            where: { id: { in: allowed.map((a) => a.id) } },
            data: publish
                ? {
                    isPublished: true,
                    publishedAt: new Date(),
                    publishedById: auth.userId,
                }
                : {
                    isPublished: false,
                    publishedAt: null,
                    publishedById: null,
                },
        });
        res.json({ ok: true, updated: result.count, published: !!publish });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to publish mark sheets");
    }
}
export async function listMyMarkSheets(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const student = await prisma.studentProfile.findFirst({
            where: { schoolId, userId: auth.userId },
            select: { id: true },
        });
        if (!student)
            throw forbidden("Student profile required");
        const sheets = await prisma.markSheet.findMany({
            where: {
                schoolId,
                studentProfileId: student.id,
                isPublished: true,
            },
            include: {
                examination: {
                    select: {
                        id: true,
                        name: true,
                        examDate: true,
                        description: true,
                        academicYear: { select: { id: true, name: true } },
                    },
                },
                subject: { select: subjectSelect },
                class: { select: classSelect },
                paper: { select: { maxMarks: true } },
            },
            orderBy: [{ examinationId: "asc" }],
        });
        const byExam = new Map();
        for (const s of sheets) {
            let group = byExam.get(s.examinationId);
            if (!group) {
                group = {
                    examination: s.examination,
                    markSheets: [],
                };
                byExam.set(s.examinationId, group);
            }
            group.markSheets.push({
                id: s.id,
                subject: s.subject,
                class: serializeClass(s.class),
                marksObtained: s.marksObtained,
                maxMarks: s.paper.maxMarks,
                publishedAt: s.publishedAt,
            });
        }
        const exams = [...byExam.values()]
            .map((g) => ({
            ...g,
            markSheets: g.markSheets.sort((a, b) => a.subject.name.localeCompare(b.subject.name)),
        }))
            .sort((a, b) => new Date(b.examination.examDate).getTime() -
            new Date(a.examination.examDate).getTime());
        res.json({ exams });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list mark sheets");
    }
}
//# sourceMappingURL=exam.controller.js.map