import path from 'node:path';

// One .env for the whole repo, at the root. On Vercel the file is absent and real env vars are used.
try { process.loadEnvFile(path.resolve(process.cwd(), '../../.env')); } catch {}

/** @type {import('next').NextConfig} */
// The NestJS prototype API (apps/api) refuses to start in production, so a production build always
// serves /v1/* from the built-in Next.js handlers in src/app/api, even if API_URL is set in the host's env.
const API_URL = process.env.NODE_ENV === 'production' ? undefined : process.env.API_URL;
// Sign-up and login live on the Fremwork website, which hands the session back to /auth/callback.
const LANDING_URL = process.env.LANDING_URL || 'https://fremwork.com';
// The Render workspace pairs with the Render landing site unless LANDING_URL says otherwise.
const PAIRED_LANDING = { 'fremwork-app.onrender.com': 'https://fremwork-land.onrender.com' };
const paired = process.env.LANDING_URL ? [] : Object.entries(PAIRED_LANDING).flatMap(([host, landing]) => {
  const has = [{ type: 'host', value: host }];
  return [
    { source: '/sign-in', has, destination: `${landing}/login`, permanent: false },
    { source: '/sign-up', has, destination: `${landing}/signup`, permanent: false },
    { source: '/forgot-password', has, destination: `${landing}/login`, permanent: false },
  ];
});

const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      ...paired,
      { source: '/sign-in', destination: `${LANDING_URL}/login`, permanent: false },
      { source: '/sign-up', destination: `${LANDING_URL}/signup`, permanent: false },
      { source: '/forgot-password', destination: `${LANDING_URL}/login`, permanent: false },
    ];
  },
  async rewrites() {
    if (API_URL) {
      return [
        {
          source: '/v1/:path*',
          destination: `${API_URL}/v1/:path*`,
        },
      ];
    }
    // Self-contained standalone mode: alias /v1/* to internal Next.js /api/* handlers
    return [
      { source: '/v1/conversations/:path*', destination: '/api/chat/:path*' },
      { source: '/v1/conversations', destination: '/api/chat' },
      { source: '/v1/transactions/:path*', destination: '/api/transactions/:path*' },
      { source: '/v1/transactions', destination: '/api/transactions' },
      { source: '/v1/budgets/:path*', destination: '/api/budgets/:path*' },
      { source: '/v1/budgets', destination: '/api/budgets' },
      { source: '/v1/goals/:path*', destination: '/api/goals/:path*' },
      { source: '/v1/goals', destination: '/api/goals' },
      { source: '/v1/projects/:path*', destination: '/api/projects/:path*' },
      { source: '/v1/projects', destination: '/api/projects' },
      { source: '/v1/tasks/:path*', destination: '/api/scheduled/:path*' },
      { source: '/v1/tasks', destination: '/api/scheduled' },
      { source: '/v1/scheduled/:path*', destination: '/api/scheduled/:path*' },
      { source: '/v1/scheduled', destination: '/api/scheduled' },
      { source: '/v1/data-sources/:path*', destination: '/api/data-sources/:path*' },
      { source: '/v1/data-sources', destination: '/api/data-sources' },
      { source: '/v1/overview', destination: '/api/analytics' },
      { source: '/v1/analytics', destination: '/api/analytics' },
      { source: '/v1/health', destination: '/api/health' },
    ];
  },
};

export default nextConfig;
