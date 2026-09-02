import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { checkRateLimit } from "./rateLimiter";

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
  const apiKey = process.env.CIRCLE_API_KEY;
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

  try {
    const body = await req.json().catch(() => ({}));

    // ── Action: Create User & Obtain userToken ────────────────
    if (action === "createUserToken") {
      // Distributed Rate Limit: 15 requests per 60s per IP
      const rateCheck = await checkRateLimit(`userToken:${clientIp}`, 15, 60_000);
      if (!rateCheck.allowed) {
        return Response.json(
          {
            success: false,
            error: "Çok fazla kullanıcı oturumu isteği gönderildi. Lütfen bekleyin.",
            retryAfter: rateCheck.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
        );
      }

      const userId = sanitizeString(body.userId, 100);
      if (!userId) {
        return Response.json({ success: false, error: "userId is required and must be valid string" }, { status: 400 });
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
      return Response.json({ 
        success: true, 
        userToken: response.data?.userToken, 
        encryptionKey: response.data?.encryptionKey 
      });
    }

    // ── Action: Request Email OTP Token ───────────────────────
    if (action === "requestEmailOtp") {
      const email = sanitizeString(body.email, 254).toLowerCase();
      const deviceId = sanitizeString(body.deviceId, 128);

      if (!deviceId || !email) {
        return Response.json({ success: false, error: "deviceId and email are required" }, { status: 400 });
      }

      if (!isValidEmail(email)) {
        return Response.json({ success: false, error: "Lütfen geçerli bir e-posta adresi girin." }, { status: 400 });
      }

      // Rate Limit 1: Max 5 requests / 60s per IP
      const ipCheck = await checkRateLimit(`otpIp:${clientIp}`, 5, 60_000);
      if (!ipCheck.allowed) {
        return Response.json(
          {
            success: false,
            error: `Çok fazla OTP isteği gönderildi. Lütfen ${ipCheck.retryAfterSeconds} saniye sonra tekrar deneyin.`,
            retryAfter: ipCheck.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(ipCheck.retryAfterSeconds) } }
        );
      }

      // Rate Limit 2: Max 3 requests / 120s per Email (Anti-Spam / Anti-Bombing)
      const emailCheck = await checkRateLimit(`otpEmail:${email}`, 3, 120_000);
      if (!emailCheck.allowed) {
        return Response.json(
          {
            success: false,
            error: `Bu e-posta adresine çok sık kod gönderildi. Lütfen ${emailCheck.retryAfterSeconds} saniye bekleyin.`,
            retryAfter: emailCheck.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(emailCheck.retryAfterSeconds) } }
        );
      }

      const client = getCircleClient();
      const response = await client.createDeviceTokenForEmailLogin({
        deviceId,
        email,
      });

      return Response.json({
        success: true,
        deviceToken: response.data?.deviceToken,
        deviceEncryptionKey: response.data?.deviceEncryptionKey,
        otpToken: response.data?.otpToken,
      });
    }

    // ── Action: Create Device Token for Social OAuth ─────────
    if (action === "createSocialDeviceToken") {
      const rateCheck = await checkRateLimit(`socialToken:${clientIp}`, 25, 60_000);
      if (!rateCheck.allowed) {
        return Response.json(
          {
            success: false,
            error: "Çok fazla istek gönderildi. Lütfen bekleyin.",
            retryAfter: rateCheck.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
        );
      }

      const deviceId = sanitizeString(body.deviceId, 128);
      if (!deviceId) {
        return Response.json({ success: false, error: "deviceId is required" }, { status: 400 });
      }

      const client = getCircleClient();
      const response = await client.createDeviceTokenForSocialLogin({
        deviceId,
      });

      return Response.json({
        success: true,
        deviceToken: response.data?.deviceToken,
        deviceEncryptionKey: response.data?.deviceEncryptionKey,
      });
    }

    // ── Action: Initialize Wallet Creation with PIN Challenge ─
    if (action === "createPinWallet" || action === "initializeUser") {
      const rateCheck = await checkRateLimit(`pinWallet:${clientIp}`, 15, 60_000);
      if (!rateCheck.allowed) {
        return Response.json(
          {
            success: false,
            error: "PIN işlemi için çok fazla deneme yapıldı. Lütfen bekleyin.",
            retryAfter: rateCheck.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
        );
      }

      const userToken = sanitizeString(body.userToken, 1024);
      if (!userToken) {
        return Response.json({ success: false, error: "userToken is required" }, { status: 400 });
      }

      const client = getCircleClient();
      try {
        const response = await client.createUserPinWithWallets({
          userToken,
          blockchains: ["EVM"], // EVM account compatibility (Arc Testnet / EVM)
          accountType: "EOA",
        });

        return Response.json({
          success: true,
          challengeId: response.data?.challengeId,
        });
      } catch (err: any) {
        const errCode = err?.response?.data?.code || err?.code;
        if (errCode === 155106) {
          return Response.json({
            success: true,
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
        return Response.json({ success: false, error: "userToken is required" }, { status: 400 });
      }

      const client = getCircleClient();
      const response = await client.listWallets({ userToken });
      return Response.json({
        success: true,
        wallets: response.data?.wallets || [],
      });
    }

    return Response.json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error("[UCW API Error]:", error?.message || error);
    const code = error?.response?.data?.code || error?.code;
    const msg = error?.response?.data?.message || error?.message || "Internal server error";
    return Response.json({ success: false, code, error: msg }, { status: 500 });
  }
}
