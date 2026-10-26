import { execSync } from "node:child_process";
import path from "node:path";

const serverDir = path.resolve(process.cwd(), "server");
console.log("Running concurrent duplicate deliveries test 25 times in a loop...");
let passes = 0;
const total = 25;

for (let i = 1; i <= total; i++) {
  const startTime = Date.now();
  try {
    execSync('npx vitest run tests/integration/webhookPersistence.integration.test.js -t "3. concurrent duplicate deliveries"', {
      cwd: serverDir,
      stdio: "pipe"
    });
    const durationMs = Date.now() - startTime;
    passes++;
    console.log(`Iteration ${String(i).padStart(2, "0")}/${total}: PASS (duration: ${durationMs}ms, exitCode: 0)`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`Iteration ${String(i).padStart(2, "0")}/${total}: FAIL (duration: ${durationMs}ms, exitCode: ${err.status || 1})`);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    break;
  }
}

console.log(`\nConcurrent test summary: ${passes} / ${total} iterations passed.`);
if (passes !== total) {
  process.exit(1);
}
