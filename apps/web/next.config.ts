import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `@solvingzero/core` reads the household fixtures (`user_data/`, `retailers.json`) off disk,
   * resolving them relative to its own compiled files. Bundling it would rewrite `import.meta.url`
   * and break those paths in a production build, so keep it external and let Node require it.
   */
  serverExternalPackages: ["@solvingzero/core"],
};

export default nextConfig;
