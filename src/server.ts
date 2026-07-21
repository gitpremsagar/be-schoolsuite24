import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import authRoutes from "./moduls/auth/auth.route.js";
import userRoutes from "./moduls/users/user.route.js";
import platformRoutes from "./moduls/platform/platform.route.js";
import schoolRoutes from "./moduls/schools/school.route.js";
import academicYearRoutes from "./moduls/academic-years/academic-year.route.js";
import classRoutes from "./moduls/classes/class.route.js";
import studentRoutes from "./moduls/students/student.route.js";
import staffRoutes from "./moduls/staff/staff.route.js";
import attendanceRoutes from "./moduls/attendance/attendance.route.js";
import billingRoutes from "./moduls/billing/billing.route.js";
import feeRoutes from "./moduls/fees/fee.route.js";
import holidayRoutes from "./moduls/holidays/holiday.route.js";
import { AppError } from "./lib/errors.js";
import { config } from "./lib/config.js";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.json({ name: "School ERP API", status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/platform", platformRoutes);
app.use("/schools", schoolRoutes);
app.use("/academic-years", academicYearRoutes);
app.use("/classes", classRoutes);
app.use("/students", studentRoutes);
app.use("/staff", staffRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/billing", billingRoutes);
app.use("/fees", feeRoutes);
app.use("/holidays", holidayRoutes);
app.use("/users", userRoutes);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Server is running on port ${port}\nhttp://localhost:${port}`);
});

void config;
