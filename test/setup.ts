import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dbPath = path.join(__dirname, "test.db");
if (fs.existsSync(dbPath)) fs.rmSync(dbPath);

process.env.DATABASE_URL = `file:${dbPath}`;

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "inherit",
});
