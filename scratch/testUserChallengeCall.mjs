import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.CIRCLE_API_KEY || "";
const client = initiateUserControlledWalletsClient({ apiKey });

try {
  const res = await client.getUserChallenge({ userToken: "invalid", challengeId: "invalid" });
  console.log("Result:", res);
} catch (err) {
  console.log("Error code:", err?.code, "status:", err?.status, "message:", err?.message);
}
