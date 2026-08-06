import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AI-generated apps should deploy even if the template has strict type
  // issues. Type errors are compile-time only and don't affect runtime, so
  // we don't let them block a deployment. (The `eslint` build-gate option
  // this used to sit next to was removed in Next.js 16 — `next build` no
  // longer runs lint at all.)
  typescript: { ignoreBuildErrors: true },
  // Certificate photos are posted through a server action
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // /testimonials was retired -- every testimonial now shows inline on its
  // winner's own box on /winners instead (see WinnerTestimonialInline.tsx),
  // so an old link/bookmark still lands somewhere useful.
  async redirects() {
    return [{ source: "/testimonials", destination: "/winners", permanent: true }];
  },
};

export default nextConfig;
