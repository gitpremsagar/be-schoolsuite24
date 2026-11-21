import "dotenv/config";
export declare const config: {
    readonly jwtAccessSecret: string;
    readonly jwtRefreshSecret: string;
    readonly accessTokenExpiry: string;
    readonly refreshTokenExpiry: string;
    readonly refreshCookieMaxAge: number;
    readonly isProduction: boolean;
    readonly refreshCookieName: "refreshToken";
    readonly staffPunchQrLinkBase: string;
    readonly appUrl: string;
    readonly passwordResetTtlMinutes: number;
    readonly smtp: {
        readonly host: string | undefined;
        readonly port: number;
        readonly secure: boolean;
        readonly tlsRejectUnauthorized: boolean;
        readonly user: string | undefined;
        readonly pass: string | undefined;
        readonly from: string;
    };
};
//# sourceMappingURL=config.d.ts.map