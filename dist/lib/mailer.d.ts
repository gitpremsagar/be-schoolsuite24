export declare function isMailConfigured(): boolean;
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
export declare function sendMail(message: MailMessage): Promise<void>;
export declare function sendPasswordResetEmail(email: string, resetUrl: string, ttlMinutes: number): Promise<void>;
export declare function sendPasswordChangedEmail(email: string): Promise<void>;
export {};
//# sourceMappingURL=mailer.d.ts.map