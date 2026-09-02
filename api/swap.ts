import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";

const kit = new AppKit();

export async function POST(req: Request) {
  const { tokenIn, tokenOut, amountIn, sourceWalletAddress, allowanceStrategy } = await req.json();

  const adapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY!,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
  });

  const kitKey = process.env.KIT_KEY

  const swapParams = {
    from: {
      adapter,
      chain: "Arc_Testnet" as const, // Fixed chain identifier
      address: sourceWalletAddress,
    },
    tokenIn,  // Must be "USDC" | "EURC" | "cirBTC"
    tokenOut, // Must be "USDC" | "EURC" | "cirBTC"
    amountIn, // Human-readable string, e.g. "1.00"
    allowanceStrategy: allowanceStrategy || "approve",
    config: {
      kitKey: kitKey || undefined, // Prevents rate limiting
    },
  };

  try {
    // 1. Get estimation
    const estimate = await kit.estimateSwap(swapParams);

    // 2. Execute swap
    const result = await kit.swap(swapParams);

    return Response.json({ success: true, estimate, result });
  } catch (error: any) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
