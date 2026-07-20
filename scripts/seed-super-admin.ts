/**
 * Create the platform Super Admin (owner of the School ERP platform).
 *
 * Usage:
 *   npm run db:seed
 *
 * Optional env (in backend/.env):
 *   SUPER_ADMIN_EMAIL=you@example.com
 *   SUPER_ADMIN_PASSWORD=your-secure-password
 *   SUPER_ADMIN_NAME=Your Name
 *
 * To reset an existing super admin password to the env/default value:
 *   SUPER_ADMIN_RESET=true npm run db:seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

async function ensureDefaultPlan() {
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { name: "Standard" },
  });
  if (plan) {
    return;
  }

  await prisma.subscriptionPlan.create({
    data: {
      name: "Standard",
      description: "Per-student subscription with 30-day free trial",
      defaultPricePerStudent: 5000,
      currency: "INR",
      interval: "MONTHLY",
      trialDays: 30,
      isActive: true,
      sortOrder: 0,
    },
  });
  console.log("Created default Standard plan (₹50.00 per student / month)");
}

async function main() {
  const email = (
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@schoolerp.local"
  ).trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "SuperAdmin123!";
  const name = process.env.SUPER_ADMIN_NAME ?? "Platform Super Admin";
  const reset = process.env.SUPER_ADMIN_RESET === "true";

  if (password.length < 8) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 8 characters");
  }

  await ensureDefaultPlan();

  const existingByEmail = await prisma.user.findUnique({ where: { email } });
  const existingSuperAdmins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { id: true, email: true, name: true, isActive: true },
  });

  if (existingByEmail) {
    if (existingByEmail.role !== "SUPER_ADMIN") {
      throw new Error(
        `User ${email} already exists with role ${existingByEmail.role}. Use a different SUPER_ADMIN_EMAIL.`,
      );
    }

    if (reset) {
      const hashed = await bcrypt.hash(password, 12);
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          password: hashed,
          name,
          isActive: true,
          schoolId: null,
        },
      });
      console.log("Updated existing Super Admin credentials:");
      console.log(`  email: ${email}`);
      console.log(`  password: ${password}`);
      console.log(`  id: ${existingByEmail.id}`);
      return;
    }

    console.log("Super Admin already exists:");
    console.log(`  email: ${existingByEmail.email}`);
    console.log(`  name: ${existingByEmail.name}`);
    console.log(`  id: ${existingByEmail.id}`);
    console.log(
      "Set SUPER_ADMIN_RESET=true to update name/password for this account.",
    );
    return;
  }

  if (existingSuperAdmins.length > 0 && !reset) {
    console.log("A Super Admin already exists on this platform:");
    for (const admin of existingSuperAdmins) {
      console.log(`  - ${admin.email} (${admin.name}) [${admin.id}]`);
    }
    console.log(
      `Creating another Super Admin at ${email}. Use SUPER_ADMIN_RESET=true only when updating an existing email.`,
    );
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      role: "SUPER_ADMIN",
      schoolId: null,
      isActive: true,
    },
  });

  console.log("Created platform Super Admin (platform owner):");
  console.log(`  email: ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  name: ${name}`);
  console.log(`  id: ${user.id}`);
  console.log("Log in at /login with these credentials.");
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
