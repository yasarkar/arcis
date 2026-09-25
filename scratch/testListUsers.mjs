import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.CIRCLE_API_KEY || "";
const client = initiateUserControlledWalletsClient({ apiKey });

async function main() {
  const usersRes = await client.listUsers();
  console.log("Users:", JSON.stringify(usersRes.data?.users, null, 2));
}

main();
