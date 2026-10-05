import { apiError } from "./_utils/apiResponse";

// Security (SEC-03): Server-controlled swaps are disabled pending cryptographic owner authorization
// and authenticated mandate policy to prevent unauthenticated execution of developer-controlled wallets.
const SWAP_DISABLED_MESSAGE = "Server-controlled swaps are disabled pending owner authorization.";

/** Never advertise an executable server-side swap route while authorization is undefined. */
export async function GET(_req: Request) {
  return apiError(SWAP_DISABLED_MESSAGE, "SWAP_AUTHORIZATION_REQUIRED", 503);
}

/** Refuse before parsing the body: no request shape can trigger a swap. */
export async function POST(_req: Request) {
  return apiError(SWAP_DISABLED_MESSAGE, "SWAP_AUTHORIZATION_REQUIRED", 503);
}
