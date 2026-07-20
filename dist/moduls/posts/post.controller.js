import { prisma } from "../../lib/prisma.js";
export async function getPosts(_req, res) {
    try {
        const posts = await prisma.post.findMany({
            include: {
                author: true,
            },
        });
        res.json(posts);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch posts" });
    }
}
//# sourceMappingURL=post.controller.js.map