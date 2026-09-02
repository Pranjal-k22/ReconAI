import { generateBenchmarkData } from "../src/services/demo/benchmarkGenerator.js";
import { exportBenchmarkToFiles } from "../src/services/demo/csvExporter.js";

console.log("⚡ Generating ReconAI 120-Scenario Synthetic Benchmark Dataset...");

try {
  const benchmarkData = generateBenchmarkData();
  const exportResult = exportBenchmarkToFiles(benchmarkData);

  console.log("✅ Benchmark dataset generated successfully!");
  console.log("📊 Summary:", JSON.stringify(benchmarkData.summary, null, 2));
  console.log(`📁 Files written to ${exportResult.targetDir}:`);
  exportResult.files.forEach((f) => console.log(`   - ${f}`));
} catch (error) {
  console.error("❌ Failed to generate benchmark dataset:", error.message);
  process.exit(1);
}
