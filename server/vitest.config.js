import { defineConfig } from "vitest/config";

const isIntegrationRun =
  process.env.npm_lifecycle_event === "test:integration" ||
  process.argv.some((arg) => typeof arg === "string" && arg.includes("integration"));

export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 15000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,vue-cli-service,nuxt}.config.*",
      ...(isIntegrationRun ? [] : ["tests/integration/**"])
    ]
  }
});
