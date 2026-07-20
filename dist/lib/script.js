import { prisma } from "./prisma.js";
async function main() {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            schoolId: true,
        },
        take: 10,
    });
    console.log("Users:", JSON.stringify(users, null, 2));
}
main()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=script.js.map