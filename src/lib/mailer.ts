import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config } from "./config.js";

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(config.smtp.host);
}

function getTransporter(): Transporter {
  if (!config.smtp.host) {
    throw new Error("SMTP is not configured. Set SMTP_HOST in the backend environment.");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
      tls: { rejectUnauthorized: config.smtp.tlsRejectUnauthorized },
    });
  }
  return transporter;
}

type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Send an email through SMTP. When SMTP is not configured (local dev) the
 * message is logged to the server console so flows stay testable without a
 * mail provider.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!isMailConfigured()) {
    console.info(
      [
        "--- [mail:console] SMTP not configured; email not sent ---",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "--- [mail:console] end ---",
      ].join("\n"),
    );
    return;
  }

  await getTransporter().sendMail({
    from: config.smtp.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  ttlMinutes: number,
): Promise<void> {
  const text = [
    "We received a request to reset your School Suite password.",
    "",
    `Open this link to choose a new password: ${resetUrl}`,
    "",
    `The link expires in ${ttlMinutes} minutes and can be used only once.`,
    "If you did not request this, you can ignore this email; your password stays the same.",
  ].join("\n");

  const html = `
    <p>We received a request to reset your School Suite password.</p>
    <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Choose a new password</a></p>
    <p style="color:#555;font-size:13px">Or paste this link into your browser:<br>${resetUrl}</p>
    <p style="color:#555;font-size:13px">The link expires in ${ttlMinutes} minutes and can be used only once. If you did not request this, you can ignore this email; your password stays the same.</p>
  `;

  await sendMail({
    to: email,
    subject: "Reset your School Suite password",
    text,
    html,
  });
}

export async function sendPasswordChangedEmail(email: string): Promise<void> {
  const text = [
    "Your School Suite password was just changed.",
    "",
    "If this was you, no action is needed.",
    "If you did not make this change, contact your school administrator immediately.",
  ].join("\n");

  await sendMail({
    to: email,
    subject: "Your School Suite password was changed",
    text,
  });
}
