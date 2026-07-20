import { Router } from "express";
import { getPosts } from "./post.controller.js";
const router = Router();
router.get("/", getPosts);
export default router;
//# sourceMappingURL=post.route.js.map