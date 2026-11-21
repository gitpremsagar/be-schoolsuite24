import { Router } from "express";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { getFeeRegister, listGradeFees, upsertGradeFees, upsertStudentFeePayment, updateStudentFeeReceipt, } from "./fee.controller.js";
const router = Router();
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription, requireRoles("ADMIN"));
router.get("/register", getFeeRegister);
router.get("/grades", listGradeFees);
router.put("/grades", upsertGradeFees);
router.put("/payments", upsertStudentFeePayment);
router.patch("/payments/:paymentId/receipt", updateStudentFeeReceipt);
export default router;
//# sourceMappingURL=fee.route.js.map