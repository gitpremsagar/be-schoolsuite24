import { Router } from "express";
import { requireAuth, requireActiveSubscription, requireRoles, requireSchoolAccess, } from "../../middleware/auth.js";
import { createHoliday, deleteHoliday, listHolidays, } from "./holiday.controller.js";
const router = Router();
router.use(requireAuth, requireSchoolAccess, requireActiveSubscription, requireRoles("ADMIN"));
router.get("/", listHolidays);
router.post("/", createHoliday);
router.delete("/:id", deleteHoliday);
export default router;
//# sourceMappingURL=holiday.route.js.map