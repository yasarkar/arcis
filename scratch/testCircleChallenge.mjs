import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.CIRCLE_API_KEY || "";
console.log("Has API key:", Boolean(apiKey), "Key length:", apiKey.length);

const client = initiateUserControlledWalletsClient({ apiKey });
console.log("Client methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
