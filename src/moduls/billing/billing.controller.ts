import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/errors.js";
import { requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";

export async function getBillingSummary(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const subscription = await prisma.schoolSubscription.findUnique({
      where: { schoolId },
      include: { plan: true },
    });
    if (!subscription) {
      throw notFound("Subscription not found");
    }

    const activeEnrollments = await prisma.enrollment.count({
      where: { schoolId, isActive: true },
    });

    const payments = await prisma.payment.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({
      subscription,
      activeEnrollments,
      pricePerStudent: subscription.pricePerStudent,
      dueAmount: activeEnrollments * subscription.pricePerStudent,
      currency: subscription.currency,
      payments,
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to load billing summary");
  }
}
