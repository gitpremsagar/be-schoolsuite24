import { Router } from "express";
import {
  requireAuth,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import { getBillingSummary } from "./billing.controller.js";

const router = Router();

// Billing is visible even when access is blocked so schools can see dues.
router.use(requireAuth, requireSchoolAccess, requireRoles("ADMIN"));

router.get("/summary", getBillingSummary);

export default router;
