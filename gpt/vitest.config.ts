import { defineConfig } from "vitest/config";

process.env.TZ = "Asia/Shanghai";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false
  }
});
