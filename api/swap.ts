import { apiError } from "./_utils/apiResponse";

export async function POST(_req: Request) {
  // Security (SEC-03): Server-controlled swaps are disabled pending cryptographic owner authorization
  // and authenticated mandate policy to prevent unauthenticated execution of developer-controlled wallets.
  return apiError(
    "Server-controlled swaps are disabled pending owner authorization.",
    "SWAP_AUTHORIZATION_REQUIRED",
    503
  );
}
