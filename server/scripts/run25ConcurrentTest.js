import { execSync } from "node:child_process";

console.log("Running concurrent duplicate deliveries test 25 times in a loop...");
let passes = 0;
const total = 25;

for (let i = 1; i <= total; i++) {
  try {
    execSync("npm test --prefix server -- tests/integration/webhookPersistence.integration.test.js -t \"3. concurrent duplicate deliveries\"", {
      cwd: process.cwd(),
      stdio: "pipe"
    });
    passes++;
    process.stdout.write(`.`);
  } catch (err) {
    console.error(`\nFailed on iteration ${i}: ${err.message}`);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    break;
  }
}

console.log(`\nConcurrent test pass count: ${passes} / ${total}`);
if (passes !== total) {
  process.exit(1);
}
