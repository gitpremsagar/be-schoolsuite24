import { Router } from "express";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { createPlan, getPlatformOverview, getSchoolDetail, listPayments, listPlans, listSchools, recordPayment, updatePlan, updateSchoolSubscription, } from "./platform.controller.js";
const router = Router();
router.use(requireAuth, requireRoles("SUPER_ADMIN"));
router.get("/overview", getPlatformOverview);
router.get("/schools", listSchools);
router.get("/schools/:id", getSchoolDetail);
router.get("/plans", listPlans);
router.post("/plans", createPlan);
router.patch("/plans/:id", updatePlan);
router.patch("/schools/:schoolId/subscription", updateSchoolSubscription);
router.post("/schools/:schoolId/payments", recordPayment);
router.get("/payments", listPayments);
export default router;
//# sourceMappingURL=platform.route.js.map