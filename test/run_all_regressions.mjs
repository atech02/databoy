import { spawnSync } from "child_process";

const suites = [
  "test/security_rules.test.mjs",
  "test/storage_rules.test.mjs",
  "test/cloud_functions.test.mjs",
  "test/backend_foundation.test.mjs",
  "test/frontend_integration.test.mjs",
  "test/marketplace_workflows.test.mjs",
  "test/lipila_payment.test.mjs",
  "test/rate_limit_and_env.test.mjs",
  "test/r2_storage.test.mjs",
];

console.log("================================================================================");
console.log("DATABOY FULL REGRESSION SUITE (PHASES 1 - 5.17)");
console.log("Running all 9 automated test suites against Firebase Emulator");
console.log("================================================================================\n");

let allPassed = true;

for (const suite of suites) {
  console.log(`\n>>> EXECUTING SUITE: ${suite} >>>`);
  const res = spawnSync("node", [suite], { stdio: "inherit", env: process.env });
  if (res.status !== 0) {
    allPassed = false;
    console.error(`FAILED: ${suite} returned exit code ${res.status}`);
  }
}

console.log("\n================================================================================");
if (allPassed) {
  console.log("ALL REGRESSION SUITES PASSED! [✓]");
  process.exit(0);
} else {
  console.error("ONE OR MORE REGRESSION SUITES FAILED! [✗]");
  process.exit(1);
}
