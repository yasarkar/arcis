import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { checkRateLimit } from "./rateLimiter";
import { apiSuccess, apiError, safeJsonParse } from "./utils/apiResponse";

// ─────────────────────────────────────────────────────────────
// 1. IP RESOLUTION HELPER
// ─────────────────────────────────────────────────────────────
function getClientIp(req: Request): string {
  const headers = req.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("true-client-ip") ||
    "127.0.0.1"
  );
}

// ─────────────────────────────────────────────────────────────
// 2. INPUT SANITIZATION & VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length > 254 || trimmed.length < 5) return false;
  return EMAIL_REGEX.test(trimmed);
}

function sanitizeString(input: any, maxLen = 128): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, maxLen);
}

// ─────────────────────────────────────────────────────────────
// 3. CIRCLE CLIENT INITIALIZATION
// ─────────────────────────────────────────────────────────────
function getCircleClient() {
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {};
  const apiKey = (globalEnv.CIRCLE_API_KEY || process.env.CIRCLE_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not configured in environment variables.");
  }
  return initiateUserControlledWalletsClient({ apiKey });
}

// ─────────────────────────────────────────────────────────────
// 4. HTTP REQUEST HANDLER (POST & OPTIONS)
// ─────────────────────────────────────────────────────────────
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const clientIp = getClientIp(req);

  const jsonResult = await safeJsonParse(req);
  if (!jsonResult.success) {
    return apiError(
      jsonResult.error || "Invalid or malformed JSON payload in request body.",
      "INVALID_JSON",
      400
    );
  }

  const body = jsonResult.data || {};

  try {
    // ── Action: Create User & Obtain userToken ────────────────
    if (action === "createUserToken") {
      // Distributed Rate Limit: 15 requests per 60s per IP
      const rateCheck = await checkRateLimit(`userToken:${clientIp}`, 15, 60_000);
      if (!rateCheck.allowed) {
        return apiError(
          "Rate limit exceeded for user sessions. Please wait before trying again.",
          "RATE_LIMIT_EXCEEDED",
          429,
          null,
          { retryAfter: rateCheck.retryAfterSeconds }
        );
      }

      const userId = sanitizeString(body.userId, 100);
      if (!userId) {
        return apiError("userId is required and must be a valid string.", "MISSING_USER_ID", 400);
      }

      const client = getCircleClient();
      
      // First ensure user exists or create user
      try {
        await client.createUser({ userId });
      } catch (err: any) {
        // Code 155106 means user already exists, which is fine
        if (err?.response?.data?.code !== 155106) {
          console.warn("[UCW API] User creation warning:", err?.message || err);
        }
      }

      // Generate user token
      const response = await client.createUserToken({ userId });
      return apiSuccess({ 
        userToken: response.data?.userToken, 
        encryptionKey: response.data?.encryptionKey 
      });
    }

    // ── Action: Request Email OTP Token ───────────────────────
    if (action === "requestEmailOtp") {
      const email = sanitizeString(body.email, 254).toLowerCase();
      const deviceId = sanitizeString(body.deviceId, 128);

      if (!deviceId || !email) {
        return apiError("deviceId and email are required.", "MISSING_PARAMETERS", 400);
      }

      if (!isValidEmail(email)) {
        return apiError("Please enter a valid email address.", "INVALID_EMAIL", 400);
      }

      // Rate Limit 1: Max 5 requests / 60s per IP
      const ipCheck = await checkRateLimit(`otpIp:${clientIp}`, 5, 60_000);
      if (!ipCheck.allowed) {
        return apiError(
          `Too many OTP requests. Please try again in ${ipCheck.retryAfterSeconds} seconds.`,
          "RATE_LIMIT_EXCEEDED",
          429,
          null,
          { retryAfter: ipCheck.retryAfterSeconds }
        );
      }

      // Rate Limit 2: Max 3 requests / 120s per Email (Anti-Spam / Anti-Bombing)
      const emailCheck = await checkRateLimit(`otpEmail:${email}`, 3, 120_000);
      if (!emailCheck.allowed) {
        return apiError(
          `Verification code was requested too frequently for this email. Please wait ${emailCheck.retryAfterSeconds} seconds.`,
          "EMAIL_RATE_LIMIT_EXCEEDED",
          429,
          null,
          { retryAfter: emailCheck.retryAfterSeconds }
        );
      }

      const client = getCircleClient();
      const response = await client.createDeviceTokenForEmailLogin({
        deviceId,
        email,
      });

      return apiSuccess({
        deviceToken: response.data?.deviceToken,
        deviceEncryptionKey: response.data?.deviceEncryptionKey,
        otpToken: response.data?.otpToken,
      });
    }

    // ── Action: Create Device Token for Social OAuth ─────────
    if (action === "createSocialDeviceToken") {
      const rateCheck = await checkRateLimit(`socialToken:${clientIp}`, 25, 60_000);
      if (!rateCheck.allowed) {
        return apiError(
          "Too many social login requests. Please wait before retrying.",
          "RATE_LIMIT_EXCEEDED",
          429,
          null,
          { retryAfter: rateCheck.retryAfterSeconds }
        );
      }

      const deviceId = sanitizeString(body.deviceId, 128);
      if (!deviceId) {
        return apiError("deviceId is required.", "MISSING_DEVICE_ID", 400);
      }

      const client = getCircleClient();
      const response = await client.createDeviceTokenForSocialLogin({
        deviceId,
      });

      return apiSuccess({
        deviceToken: response.data?.deviceToken,
        deviceEncryptionKey: response.data?.deviceEncryptionKey,
      });
    }

    // ── Action: Initialize Wallet Creation with PIN Challenge ─
    if (action === "createPinWallet" || action === "initializeUser") {
      const rateCheck = await checkRateLimit(`pinWallet:${clientIp}`, 15, 60_000);
      if (!rateCheck.allowed) {
        return apiError(
          "Too many PIN setup attempts. Please wait before retrying.",
          "RATE_LIMIT_EXCEEDED",
          429,
          null,
          { retryAfter: rateCheck.retryAfterSeconds }
        );
      }

      const userToken = sanitizeString(body.userToken, 1024);
      if (!userToken) {
        return apiError("userToken is required.", "MISSING_USER_TOKEN", 400);
      }

      const client = getCircleClient();
      try {
        const response = await client.createUserPinWithWallets({
          userToken,
          blockchains: ["EVM"], // EVM account compatibility (Arc Testnet / EVM)
          accountType: "EOA",
        });

        return apiSuccess({
          challengeId: response.data?.challengeId,
        });
      } catch (err: any) {
        const errCode = err?.response?.data?.code || err?.code;
        if (errCode === 155106) {
          return apiSuccess({
            code: 155106,
            message: "User already initialized",
          });
        }
        throw err;
      }
    }

    // ── Action: Fetch User Wallets ────────────────────────────
    if (action === "getUserWallets" || action === "listWallets") {
      const userToken = sanitizeString(body.userToken, 1024);
      if (!userToken) {
        return apiError("userToken is required.", "MISSING_USER_TOKEN", 400);
      }

      const client = getCircleClient();
      const response = await client.listWallets({ userToken });
      return apiSuccess({
        wallets: response.data?.wallets || [],
      });
    }

    return apiError(`Invalid action: ${action}`, "INVALID_ACTION", 400);
  } catch (error: any) {
    console.error("[UCW API Error]:", error?.message || error);
    const code = error?.response?.data?.code || error?.code || "UCW_INTERNAL_ERROR";
    const msg = error?.response?.data?.message || error?.message || "Internal server error occurred in Circle UCW service.";
    return apiError(msg, String(code), 500, error?.details || null);
  }
}
