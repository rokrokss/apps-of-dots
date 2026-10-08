import { resolve } from "node:path";
import { run } from "./server.js";

try {
  if (!process.argv[2]) throw new Error("Missing apps-of-dots data directory.");
  process.exitCode = await run(resolve(process.argv[2]));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
