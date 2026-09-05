import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { apiSuccess, apiError, safeJsonParse } from "./utils/apiResponse";

const kit = new AppKit();

export async function POST(req: Request) {
  const jsonResult = await safeJsonParse(req);
  if (!jsonResult.success) {
    return apiError(
      jsonResult.error || "Invalid or malformed JSON payload in request body.",
      "INVALID_JSON",
      400
    );
  }

  const { tokenIn, tokenOut, amountIn, sourceWalletAddress, allowanceStrategy } = jsonResult.data || {};

  // Parameter validation
  if (!tokenIn || !tokenOut || !amountIn || !sourceWalletAddress) {
    return apiError(
      "Missing required swap parameters: tokenIn, tokenOut, amountIn, and sourceWalletAddress are all required.",
      "MISSING_PARAMETERS",
      400
    );
  }

  const globalEnv = (typeof globalThis !== "undefined" && (globalThis as any).process?.env) || {};
  const apiKey = (globalEnv.CIRCLE_API_KEY || process.env.CIRCLE_API_KEY || "").trim();
  const entitySecret = (globalEnv.CIRCLE_ENTITY_SECRET || process.env.CIRCLE_ENTITY_SECRET || "").trim();

  if (!apiKey || !entitySecret) {
    return apiError(
      "Circle Developer-Controlled Wallets credentials (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET) are not configured on the server.",
      "MISSING_CREDENTIALS",
      500
    );
  }

  const kitKey = (globalEnv.KIT_KEY || process.env.KIT_KEY || "").trim();

  try {
    const adapter = createCircleWalletsAdapter({
      apiKey,
      entitySecret,
    });

    const swapParams = {
      from: {
        adapter,
        chain: "Arc_Testnet" as const, // Fixed chain identifier
        address: sourceWalletAddress,
      },
      tokenIn, // Must be "USDC" | "EURC" | "cirBTC"
      tokenOut, // Must be "USDC" | "EURC" | "cirBTC"
      amountIn: String(amountIn), // Human-readable string, e.g. "1.00"
      allowanceStrategy: allowanceStrategy || "approve",
      config: {
        kitKey: kitKey || undefined, // Prevents rate limiting
      },
    };

    // 1. Get estimation
    const estimate = await kit.estimateSwap(swapParams);

    // 2. Execute swap
    const result = await kit.swap(swapParams);

    return apiSuccess({
      estimate,
      result,
      message: "Swap transaction executed successfully on Arc Testnet.",
    });
  } catch (error: any) {
    console.error("[Swap API Error]:", error);
    return apiError(
      error?.message || "An unexpected error occurred during swap execution.",
      error?.code || "SWAP_EXECUTION_FAILED",
      500,
      error?.details || null
    );
  }
}
