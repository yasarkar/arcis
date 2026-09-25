import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.CIRCLE_API_KEY || "";
const client = initiateUserControlledWalletsClient({ apiKey });

async function main() {
  try {
    const usersRes = await client.listUsers();
    console.log("Users count:", usersRes.data?.users?.length);
    if (usersRes.data?.users?.length > 0) {
      const user = usersRes.data.users[0];
      console.log("First user ID:", user.id);
      
      const tokenRes = await client.createUserToken({ userId: user.id });
      const userToken = tokenRes.data?.userToken;
      console.log("Got user token:", Boolean(userToken));

      const walletsRes = await client.listWallets({ userToken });
      console.log("Wallets count:", walletsRes.data?.wallets?.length);
      for (const w of (walletsRes.data?.wallets || [])) {
        console.log("  Wallet:", w.id, w.blockchain, w.address);
      }

      // Test listTransactions
      console.log("\nTesting listTransactions...");
      const txRes = await client.listTransactions({ userToken, order: "DESC" });
      console.log("Transactions count:", txRes.data?.transactions?.length);
      for (const t of (txRes.data?.transactions || []).slice(0, 5)) {
        console.log("  Tx:", t.id, "state:", t.state, "txHash:", t.txHash, "blockchain:", t.blockchain, "txType:", t.txType);
      }

      // Test listUserChallenges
      console.log("\nTesting listUserChallenges...");
      const chRes = await client.listUserChallenges({ userToken });
      console.log("Challenges count:", chRes.data?.challenges?.length);
      for (const c of (chRes.data?.challenges || []).slice(0, 5)) {
        console.log("  Challenge:", c.id, "status:", c.status, "type:", c.challengeType, "correlationIds:", c.correlationIds);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
