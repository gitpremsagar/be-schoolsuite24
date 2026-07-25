import { Router } from "express";
import {
  requireAuth,
  requireActiveSubscription,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import {
  createEventFee,
  deactivateEventFee,
  getEventFee,
  getEventFeeRegister,
  listEventFees,
  updateEventFee,
  upsertEventFeePayment,
} from "./event-fee.controller.js";

const router = Router();

router.use(
  requireAuth,
  requireSchoolAccess,
  requireActiveSubscription,
  requireRoles("ADMIN"),
);

router.get("/", listEventFees);
router.post("/", createEventFee);
router.get("/:id", getEventFee);
router.patch("/:id", updateEventFee);
router.delete("/:id", deactivateEventFee);
router.get("/:id/register", getEventFeeRegister);
router.put("/:id/payments", upsertEventFeePayment);

export default router;
