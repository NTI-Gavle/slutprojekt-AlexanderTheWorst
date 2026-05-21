import { Redis } from "ioredis";
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = import.meta.dirname;

// Walk up to workspace root where .env lives
config({ path: resolve(__dirname, "../../../.env") });

export const redis = new Redis({
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
});