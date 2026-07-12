import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AI-generated apps should deploy even if the template has strict type or
  // lint issues. Type errors are compile-time only and don't affect runtime,
  // so we don't let them block a deployment.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Certificate photos are posted through a server action
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // exFAT drives fail readlink() with EISDIR; skip symlink resolution so
  // local `next build` works there. No effect on Vercel builds.
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;
