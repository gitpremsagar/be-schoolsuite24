import { Router } from "express";
import {
  requireAuth,
  requireActiveSubscription,
  requireRoles,
  requireSchoolAccess,
} from "../../middleware/auth.js";
import { getUsers } from "./user.controller.js";

const router = Router();

router.use(
  requireAuth,
  requireSchoolAccess,
  requireActiveSubscription,
  requireRoles("ADMIN"),
);

router.get("/", getUsers);

export default router;
