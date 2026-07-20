import { Router } from "express";
import {
  requireAuth,
  requireActiveSubscription,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import {
  getFeeRegister,
  listGradeFees,
  upsertGradeFees,
  upsertStudentFeePayment,
} from "./fee.controller.js";

const router = Router();

router.use(
  requireAuth,
  requireSchoolAccess,
  requireActiveSubscription,
  requireRoles("ADMIN"),
);

router.get("/register", getFeeRegister);
router.get("/grades", listGradeFees);
router.put("/grades", upsertGradeFees);
router.put("/payments", upsertStudentFeePayment);

export default router;
