import path from 'node:path';
import type { NextConfig } from 'next';

// One .env for the whole repo, at the root. On Vercel the file is absent and real env vars are used.
try { process.loadEnvFile(path.resolve(process.cwd(), '../../.env')); } catch {}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return ['/auth/:path*', '/open-app'].map((source) => ({ source, headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'no-store' },
    ] }));
  },
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  // Type errors still fail the build. No ESLint config is set up yet.
  eslint: { ignoreDuringBuilds: true },
  // Old waitlist links, including ones already shared, go to sign-up.
  async redirects() {
    return [{ source: '/waitlist', destination: '/signup', permanent: true }];
  },
};

export default nextConfig;
