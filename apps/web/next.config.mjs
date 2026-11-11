import path from 'node:path';

// One .env for the whole repo, at the root. On Vercel the file is absent and real env vars are used.
try { process.loadEnvFile(path.resolve(process.cwd(), '../../.env')); } catch {}

// The web app serves /v1/* from its own route handlers in src/app/api. In development only, API_URL
// can point /v1/* at a separately running apps/api instead; production builds ignore it.
const API_URL = process.env.NODE_ENV === 'production' ? undefined : process.env.API_URL;

// Sign-in, sign-up and password reset happen on this site. Sessions are never handed over from
// another domain (that pattern got the Render workspace flagged by Google Safe Browsing).

/**
 * Browser security headers for every response. The CSP is limited to directives that can't break
 * Next.js's inline bootstrap scripts: no framing (clickjacking), forms may only post to this origin,
 * no <base> hijacking and no plugins.
 */
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
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
