import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.CIRCLE_API_KEY || "";
const client = initiateUserControlledWalletsClient({ apiKey });

async function main() {
  try {
    const res = await client.listWallets({ userId: "c8f93a7a-aa02-5996-8f65-51401b520862" });
    console.log("Wallets:", JSON.stringify(res.data?.wallets, null, 2));
  } catch (err) {
    console.error("listWallets error:", err?.response?.data || err);
  }
}

main();
