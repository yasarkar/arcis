import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import { checkRateLimit } from "./_utils/rateLimiter";
import { apiSuccess, apiError, safeJsonParse } from "./_utils/apiResponse";

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
        const isTestnet = (process.env.VITE_APP_ENV || 'testnet').toLowerCase() !== 'mainnet';
        const targetBlockchain = isTestnet ? 'ARC-TESTNET' : 'ARC';
        console.log(`[UCW API] Initializing user on blockchain: ${targetBlockchain}...`);

        let response: any;
        try {
          response = await client.createUserPinWithWallets({
            userToken,
            blockchains: [targetBlockchain as any],
            accountType: "EOA",
          });
          console.log("[UCW API] createUserPinWithWallets (EOA) success, challengeId:", response.data?.challengeId);
        } catch (eoaErr: any) {
          const eoaCode = eoaErr?.code || eoaErr?.response?.data?.code;
          if (eoaCode === 155106) {
            console.log("[UCW API] User already initialized (code 155106)");
            return apiSuccess({
              code: 155106,
              message: "User already initialized",
            });
          }
          console.warn("[UCW API] EOA creation failed, attempting fallback without explicit accountType:", eoaErr?.message);
          response = await client.createUserPinWithWallets({
            userToken,
            blockchains: [targetBlockchain as any],
          });
          console.log("[UCW API] createUserPinWithWallets (fallback) success, challengeId:", response.data?.challengeId);
        }

        return apiSuccess({
          challengeId: response.data?.challengeId,
        });
      } catch (err: any) {
        const errCode = err?.response?.data?.code || err?.code;
        if (errCode === 155106) {
          console.log("[UCW API] User already initialized (155106)");
          return apiSuccess({
            code: 155106,
            message: "User already initialized",
          });
        }
        console.error("[UCW API] createUserPinWithWallets error:", {
          code: errCode,
          message: err?.message,
          data: err?.response?.data,
        });
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

    // ── Action: Create Wallet on an additional blockchain ─────
    // Circle executes transactions on the wallet's own blockchain, so a UCW user
    // must own a wallet (same EVM address) on every chain they act on. Without
    // this, a destination-chain mint would silently run on the source chain.
    if (action === "createUserWallet") {
      const userToken = sanitizeString(body.userToken, 1024);
      const blockchain = sanitizeString(body.blockchain, 64).toUpperCase();

      if (!userToken || !blockchain) {
        return apiError("userToken and blockchain are required.", "MISSING_PARAMETERS", 400);
      }

      const rateCheck = await checkRateLimit(`createWallet:${clientIp}`, 20, 60_000);
      if (!rateCheck.allowed) {
        return apiError(
          "Too many wallet creation attempts. Please wait before trying again.",
          "RATE_LIMIT_EXCEEDED",
          429,
          null,
          { retryAfter: rateCheck.retryAfterSeconds }
        );
      }

      const client = getCircleClient();

      // Idempotency: if the wallet already exists on that blockchain, do not create another.
      try {
        const walletsRes = await client.listWallets({ userToken });
        const existing = (walletsRes.data?.wallets || []).find(
          (w: any) => w.blockchain?.toUpperCase() === blockchain
        );
        if (existing) {
          return apiSuccess({
            alreadyExists: true,
            walletId: existing.id,
            address: existing.address,
          });
        }
      } catch (wErr) {
        console.warn("[UCW API] listWallets warning during createUserWallet:", wErr);
      }

      console.log("[UCW API] Creating user wallet on blockchain:", blockchain);
      const response = await client.createWallet({
        userToken,
        blockchains: [blockchain as any],
        accountType: "EOA" as any,
      });

      return apiSuccess({
        challengeId: response.data?.challengeId,
        blockchain,
      });
    }

    // ── Action: Create Contract Execution Challenge ──────────
    if (action === "createContractExecution") {
      const userToken = sanitizeString(body.userToken, 1024);
      let walletId = sanitizeString(body.walletId, 128);
      const walletAddress = body.walletAddress ? sanitizeString(body.walletAddress, 128) : undefined;
      const contractAddress = sanitizeString(body.contractAddress, 128);
      const abiFunctionSignature = sanitizeString(body.abiFunctionSignature, 256);
      const abiParameters = Array.isArray(body.abiParameters) ? body.abiParameters : undefined;
      const callData = body.callData ? sanitizeString(body.callData, 4096) : undefined;
      const amount = body.amount ? sanitizeString(body.amount, 64) : undefined;
      const blockchain = body.blockchain ? sanitizeString(body.blockchain, 64) : 'ARC-TESTNET';

      if (!userToken || !contractAddress) {
        return apiError("userToken and contractAddress are required.", "MISSING_PARAMETERS", 400);
      }

      const client = getCircleClient();

      // Resolve the wallet that owns the requested blockchain.
      //
      // SECURITY: Circle executes the transaction on the wallet's own blockchain, so
      // never fall back to a wallet created on a different chain — the call would run
      // (and revert) on the source chain after the user's source funds were burned.
      let targetWalletId = walletId;
      if (blockchain) {
        try {
          const walletsRes = await client.listWallets({ userToken });
          const userWallets = walletsRes.data?.wallets || [];
          const matchingWallet = userWallets.find(
            (w: any) => w.blockchain?.toUpperCase() === blockchain.toUpperCase()
          );
          targetWalletId = matchingWallet ? matchingWallet.id : "";
        } catch (wErr) {
          console.warn("[UCW API] listWallets warning:", wErr);
          return apiError(
            `Unable to resolve the ${blockchain} wallet for this account.`,
            "WALLET_LOOKUP_FAILED",
            502
          );
        }
      } else if (!targetWalletId) {
        try {
          const walletsRes = await client.listWallets({ userToken });
          targetWalletId = walletsRes.data?.wallets?.[0]?.id || "";
        } catch (wErr) {
          console.warn("[UCW API] listWallets warning:", wErr);
        }
      }

      if (!targetWalletId && !walletAddress) {
        return apiError(
          blockchain
            ? `No ${blockchain} wallet exists for this account yet. Create it first (action=createUserWallet) and retry.`
            : "No Circle wallet found for this user account.",
          blockchain ? "NO_WALLET_FOR_BLOCKCHAIN" : "NO_WALLET_FOUND",
          blockchain ? 409 : 404
        );
      }

      const execParams: any = {
        userToken,
        contractAddress,
        fee: {
          type: "level",
          config: {
            feeLevel: "MEDIUM",
          },
        },
      };

      if (targetWalletId) {
        // NOTE: Per Circle API specifications, `walletId` and `blockchain`/`walletAddress`
        // are mutually exclusive. The blockchain was used above to select the wallet.
        execParams.walletId = targetWalletId;
      } else {
        execParams.walletAddress = walletAddress;
        execParams.blockchain = blockchain;
      }

      // Prefer abiFunctionSignature and abiParameters for user-controlled wallets
      // (Circle's challenge UI requires decoded function signatures to display on user confirmation modal)
      if (abiFunctionSignature && abiParameters) {
        execParams.abiFunctionSignature = abiFunctionSignature;
        execParams.abiParameters = abiParameters;
      } else if (callData) {
        execParams.callData = callData;
      }

      if (amount) {
        execParams.amount = amount;
      }

      console.log("[UCW API] Creating contract execution challenge for wallet:", targetWalletId, "contract:", contractAddress);
      const response = await client.createUserTransactionContractExecutionChallenge(execParams);
      return apiSuccess({
        challengeId: response.data?.challengeId,
        walletId: targetWalletId || undefined,
      });
    }

    // ── Action: Sign Typed Data (EIP-712) ────────────────────
    if (action === "signTypedData") {
      const userToken = sanitizeString(body.userToken, 1024);
      let walletId = sanitizeString(body.walletId, 128);
      const rawData = body.data;
      const memo = body.memo ? sanitizeString(body.memo, 128) : undefined;
      const blockchain = body.blockchain ? sanitizeString(body.blockchain, 64) : 'ARC-TESTNET';

      if (!userToken || !rawData) {
        return apiError("userToken and data are required.", "MISSING_PARAMETERS", 400);
      }

      const client = getCircleClient();

      // Resolve the wallet that owns the requested blockchain (no cross-chain fallback:
      // a signature produced by a wallet on a different chain is invalid for this domain).
      let targetWalletId = walletId;
      if (blockchain) {
        try {
          const walletsRes = await client.listWallets({ userToken });
          const userWallets = walletsRes.data?.wallets || [];
          const matchingWallet = userWallets.find(
            (w: any) => w.blockchain?.toUpperCase() === blockchain.toUpperCase()
          );
          targetWalletId = matchingWallet ? matchingWallet.id : "";
        } catch (wErr) {
          console.warn("[UCW API] listWallets warning:", wErr);
          return apiError(
            `Unable to resolve the ${blockchain} wallet for this account.`,
            "WALLET_LOOKUP_FAILED",
            502
          );
        }
      } else if (!targetWalletId) {
        try {
          const walletsRes = await client.listWallets({ userToken });
          targetWalletId = walletsRes.data?.wallets?.[0]?.id || "";
        } catch (wErr) {
          console.warn("[UCW API] listWallets warning:", wErr);
        }
      }

      if (!targetWalletId) {
        return apiError(
          blockchain
            ? `No ${blockchain} wallet exists for this account yet. Create it first (action=createUserWallet) and retry.`
            : "No Circle wallet found for this user account.",
          blockchain ? "NO_WALLET_FOR_BLOCKCHAIN" : "NO_WALLET_FOUND",
          blockchain ? 409 : 404
        );
      }

      const dataStr = typeof rawData === "string" ? rawData : JSON.stringify(rawData);

      const signParams: any = {
        userToken,
        walletId: targetWalletId,
        data: dataStr,
      };

      if (memo) signParams.memo = memo;

      // NOTE: Per Circle API specifications, `walletId` and `blockchain` are mutually exclusive.
      // Passing `blockchain` when `walletId` is present causes "API parameter invalid".
      // Therefore, `blockchain` is used solely to select the appropriate `targetWalletId` above.

      console.log("[UCW API] Creating signTypedData challenge for wallet:", targetWalletId, "blockchain:", blockchain || "default");
      const response = await client.signTypedData(signParams);
      return apiSuccess({
        challengeId: response.data?.challengeId,
        walletId: targetWalletId,
      });
    }

    // ── Action: Create Transfer Challenge ─────────────────────
    if (action === "createTransfer") {
      const userToken = sanitizeString(body.userToken, 1024);
      let walletId = sanitizeString(body.walletId, 128);
      const destinationAddress = sanitizeString(body.destinationAddress, 128);
      const amount = sanitizeString(body.amount, 64);
      const tokenId = body.tokenId ? sanitizeString(body.tokenId, 128) : undefined;
      const tokenAddressParam = body.tokenAddress !== undefined ? sanitizeString(body.tokenAddress, 128) : undefined;
      const blockchainParam = sanitizeString(body.blockchain, 64) || "ARC-TESTNET";
      const tokenSymbol = sanitizeString(body.tokenSymbol || body.token, 32);

      if (!userToken || !destinationAddress || !amount) {
        return apiError("userToken, destinationAddress, and amount are required.", "MISSING_PARAMETERS", 400);
      }

      const client = getCircleClient();

      let targetWalletId = walletId;
      if (blockchainParam) {
        try {
          const walletsRes = await client.listWallets({ userToken });
          const userWallets = walletsRes.data?.wallets || [];
          const matchingWallet = userWallets.find(
            (w: any) => w.blockchain?.toUpperCase() === blockchainParam.toUpperCase()
          );
          if (matchingWallet) {
            targetWalletId = matchingWallet.id;
          }
        } catch (wErr) {
          console.warn("[UCW API] listWallets warning in createTransfer:", wErr);
        }
      }
      if (!targetWalletId) {
        try {
          const walletsRes = await client.listWallets({ userToken });
          targetWalletId = walletsRes.data?.wallets?.[0]?.id || "";
        } catch (wErr) {
          console.warn("[UCW API] listWallets fallback warning:", wErr);
        }
      }

      if (!targetWalletId) {
        return apiError(
          blockchainParam
            ? `No ${blockchainParam} wallet exists for this account yet. Create it first (action=createUserWallet) and retry.`
            : "No Circle wallet found for this user account.",
          blockchainParam ? "NO_WALLET_FOR_BLOCKCHAIN" : "NO_WALLET_FOUND",
          blockchainParam ? 409 : 404
        );
      }
      walletId = targetWalletId;

      let resolvedTokenId = tokenId;
      let resolvedTokenAddress = tokenAddressParam;

      // Auto-resolve token if neither tokenId nor tokenAddress was explicitly provided
      if (!resolvedTokenId && resolvedTokenAddress === undefined) {
        const isArcChain = blockchainParam.toUpperCase().includes("ARC");
        if (tokenSymbol === "NATIVE" || (tokenSymbol === "USDC" && isArcChain)) {
          // On Arc Testnet native token is USDC: empty string tokenAddress indicates native transfer
          resolvedTokenAddress = "";
        } else {
          // Known USDC ERC-20 addresses across Circle-supported testnet chains
          const KNOWN_USDC: Record<string, string> = {
            'BASE-SEPOLIA': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            'ETH-SEPOLIA': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            'ARB-SEPOLIA': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            'OP-SEPOLIA': '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
            'AVAX-FUJI': '0x5425890298aed601595a70ab815c96711a31bc65',
            'MATIC-AMOY': '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582',
          };

          if (tokenSymbol === "USDC" && KNOWN_USDC[blockchainParam]) {
            resolvedTokenAddress = KNOWN_USDC[blockchainParam];
          } else {
            try {
              const balanceRes = await client.getWalletTokenBalance({ walletId, userToken });
              const balances = balanceRes.data?.tokenBalances || [];
              const matchedToken = balances.find((t: any) => 
                t.token?.symbol?.toUpperCase() === tokenSymbol.toUpperCase() ||
                t.token?.name?.toUpperCase() === tokenSymbol.toUpperCase()
              );
              if (matchedToken) {
                if (matchedToken.token?.id) {
                  resolvedTokenId = matchedToken.token.id;
                } else if (matchedToken.token?.tokenAddress) {
                  resolvedTokenAddress = matchedToken.token.tokenAddress;
                }
              }
            } catch (bErr) {
              console.warn("[UCW API] Failed to auto-resolve token from wallet balance:", bErr);
              resolvedTokenAddress = "";
            }
          }
        }
      }

      const feeLevel = sanitizeString(body.feeLevel, 16).toUpperCase() || "MEDIUM";
      const validFeeLevel = (feeLevel === "LOW" || feeLevel === "HIGH") ? feeLevel : "MEDIUM";

      const transferParams: any = {
        userToken,
        walletId,
        destinationAddress,
        amounts: [amount],
        fee: {
          type: "level",
          config: {
            feeLevel: validFeeLevel,
          },
        },
      };

      if (resolvedTokenId) {
        transferParams.tokenId = resolvedTokenId;
      } else {
        transferParams.tokenAddress = resolvedTokenAddress ?? "";
        transferParams.blockchain = blockchainParam;
      }

      console.log("[UCW API] Creating transfer challenge for wallet:", walletId, "to:", destinationAddress, "params:", transferParams);
      const response = await client.createTransaction(transferParams);
      return apiSuccess({
        challengeId: response.data?.challengeId,
        walletId,
      });
    }

    // ── Action: Get Latest On-Chain Transaction Hash ──────────
    if (action === "getLatestTransaction" || action === "pollTransactionHash") {
      const userToken = sanitizeString(body.userToken, 1024);
      const challengeId = sanitizeString(body.challengeId, 128);
      const walletId = sanitizeString(body.walletId, 128);
      const blockchain = sanitizeString(body.blockchain, 64);

      if (!userToken) {
        return apiError("userToken is required.", "MISSING_USER_TOKEN", 400);
      }

      const client = getCircleClient();
      try {
        let transactionId = sanitizeString(body.transactionId, 128);

        // 1. Resolve exact transaction ID from challenge correlationIds (quick attempt)
        if (challengeId && !transactionId) {
          try {
            const chRes = await client.getUserChallenge({ userToken, challengeId });
            const correlationIds = chRes.data?.challenge?.correlationIds || [];
            if (correlationIds.length > 0 && correlationIds[0]) {
              transactionId = correlationIds[0];
              console.log("[UCW API] Resolved transactionId from challenge correlationIds:", transactionId);
            }
          } catch (cErr) {
            console.warn("[UCW API] getUserChallenge lookup warning:", cErr);
          }
        }

        // 2. Query exact transaction if transactionId is available
        if (transactionId) {
          try {
            const txRes = await client.getTransaction({ userToken, id: transactionId });
            const tx = txRes.data?.transaction;
            const txHash = tx?.txHash;
            if (txHash && txHash.startsWith("0x")) {
              console.log("[UCW API] Found on-chain txHash from getTransaction:", txHash);
              return apiSuccess({
                txHash,
                state: tx?.state,
                id: tx?.id,
                blockchain: tx?.blockchain,
                operation: tx?.operation,
              });
            }
          } catch (tErr) {
            console.warn("[UCW API] getTransaction warning:", tErr);
          }
        }

        // 3. Query listTransactions across both CONTRACT_EXECUTION and TRANSFER
        const fetchTxList = async (operation: "CONTRACT_EXECUTION" | "TRANSFER", withFilters: boolean) => {
          try {
            const params: any = {
              userToken,
              operation,
              includeAll: true,
              order: "DESC",
              pageSize: 10,
            };
            if (withFilters) {
              if (blockchain) params.blockchain = blockchain;
              if (walletId) params.walletIds = [walletId];
            }
            const res = await client.listTransactions(params);
            return res.data?.transactions || [];
          } catch (err: any) {
            console.warn(`[UCW API] listTransactions (${operation}, filters=${withFilters}) warning:`, err?.message || err);
            return [];
          }
        };

        // Query both operations in parallel (with filters if provided)
        let [contractTxs, transferTxs] = await Promise.all([
          fetchTxList("CONTRACT_EXECUTION", Boolean(blockchain || walletId)),
          fetchTxList("TRANSFER", Boolean(blockchain || walletId)),
        ]);

        let allTxs = [...contractTxs, ...transferTxs];

        // If no transactions found with filters, do broad query without blockchain/walletId
        if (allTxs.length === 0 && (blockchain || walletId)) {
          const [broadContract, broadTransfer] = await Promise.all([
            fetchTxList("CONTRACT_EXECUTION", false),
            fetchTxList("TRANSFER", false),
          ]);
          allTxs = [...broadContract, ...broadTransfer];
        }

        // Sort descending by updateDate or createDate
        allTxs.sort((a: any, b: any) => {
          const tA = new Date(a.updateDate || a.createDate || 0).getTime();
          const tB = new Date(b.updateDate || b.createDate || 0).getTime();
          return tB - tA;
        });

        const validTx = allTxs.find((t: any) => t.txHash && typeof t.txHash === "string" && t.txHash.startsWith("0x"));
        if (validTx) {
          console.log("[UCW API] Found on-chain txHash from listTransactions:", validTx.txHash, "operation:", validTx.operation, "blockchain:", validTx.blockchain);
          return apiSuccess({
            txHash: validTx.txHash,
            state: validTx.state,
            id: validTx.id,
            blockchain: validTx.blockchain,
            operation: validTx.operation,
          });
        }

        return apiSuccess({
          txHash: null,
          state: allTxs[0]?.state || "PENDING",
          id: allTxs[0]?.id || transactionId || null,
          message: "Transaction broadcasted; hash pending on-chain indexing.",
        });
      } catch (err: any) {
        console.error("[UCW API] getLatestTransaction error:", err);
        return apiError(err.message || "Failed to fetch transaction hash", "FETCH_TX_FAILED", 500);
      }
    }

    return apiError(`Invalid action: ${action}`, "INVALID_ACTION", 400);
  } catch (error: any) {
    console.error("[UCW API Error]:", error?.message || error);
    if (error?.response?.data) {
      console.error("[UCW API Error Details]:", JSON.stringify(error.response.data, null, 2));
    }
    const code = error?.response?.data?.code || error?.code || "UCW_INTERNAL_ERROR";
    const msg = error?.response?.data?.message || error?.message || "Internal server error occurred in Circle UCW service.";
    return apiError(msg, String(code), 500, error?.response?.data || error?.details || null);
  }
}
