/**
 * Runtime configuration for the API, read from the environment. Everything the API needs to
 * talk to Supabase and the AI providers is here, so production can fail fast on a bad setup.
 */

const first = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
};

const isPlaceholder = (value: string) => !value || /your[-_]|placeholder|changeme/i.test(value);

/** The public Fremwork origins that may call this API from a browser. */
export const DEFAULT_CORS_ORIGINS = [
  'https://app.fremwork.com',
  'https://fremwork.com',
  'https://www.fremwork.com',
  'https://fremwork-app.onrender.com',
  'https://fremwork-land.onrender.com',
];

export interface ApiConfig {
  production: boolean;
  port: number;
  supabaseUrl: string;
  /** Publishable (anon) key. It only identifies the project; every query runs as the signed-in user. */
  supabaseKey: string;
  corsOrigins: string[];
  geminiKey: string | null;
  geminiModel: string | null;
  geminiFallbackModel: string | null;
  anthropicKey: string | null;
  anthropicModel: string;
  aiDailyLimit: number;
}

export function loadConfig(): ApiConfig {
  const production = process.env.NODE_ENV === 'production';
  const geminiKey = first('GEMINI_API_KEY', 'GOOGLE_API_KEY');
  const anthropicKey = first('ANTHROPIC_API_KEY');
  const cors = first('CORS_ORIGINS');
  return {
    production,
    port: Number(first('PORT')) || 4000,
    supabaseUrl: first('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, ''),
    supabaseKey: first(
      'SUPABASE_ANON_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_KEY',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ),
    corsOrigins: (cors ? cors.split(',') : DEFAULT_CORS_ORIGINS).map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    geminiKey: isPlaceholder(geminiKey) ? null : geminiKey,
    geminiModel: first('GEMINI_MODEL') || null,
    geminiFallbackModel: first('GEMINI_FALLBACK_MODEL') || null,
    anthropicKey: isPlaceholder(anthropicKey) ? null : anthropicKey,
    anthropicModel: first('ANTHROPIC_MODEL') || 'claude-opus-5-5',
    aiDailyLimit: Number(first('AI_DAILY_LIMIT')) || 50,
  };
}

/**
 * Exact-match CORS check. Production allows only the configured origins; development also allows
 * http://localhost and http://127.0.0.1 on any port. Requests without an Origin (curl, servers) pass,
 * since CORS only governs browsers and every data route still requires a bearer token.
 */
export function isAllowedOrigin(origin: string | undefined, config: Pick<ApiConfig, 'corsOrigins' | 'production'>): boolean {
  if (!origin) return true;
  if (config.corsOrigins.includes(origin)) return true;
  return !config.production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** Problems that stop the API from serving real users. Empty means the configuration is usable. */
export function configErrors(config: ApiConfig): string[] {
  const errors: string[] = [];
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(config.supabaseUrl) && !(!config.production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(config.supabaseUrl))) {
    errors.push('SUPABASE_URL must be set to your Supabase project URL (https://<ref>.supabase.co).');
  }
  if (!config.supabaseKey) errors.push('SUPABASE_ANON_KEY (the publishable/anon key) must be set.');
  if (isPrivilegedKey(config.supabaseKey)) {
    errors.push('The Supabase key is a service-role/secret key. This API reads data as the signed-in user so row level security applies; use the publishable (anon) key.');
  }
  if (config.geminiKey && !config.geminiModel) errors.push('GEMINI_MODEL must be set when GEMINI_API_KEY is set.');
  if (config.geminiModel && !/^[a-zA-Z0-9._-]+$/.test(config.geminiModel)) errors.push('GEMINI_MODEL contains invalid characters.');
  if (config.corsOrigins.some((o) => o === '*' || !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o))) {
    errors.push('CORS_ORIGINS must be a comma-separated list of exact origins such as https://app.fremwork.com (no wildcards or paths).');
  }
  return errors;
}

/** A new-style secret key, or a legacy JWT key whose role is service_role. */
export function isPrivilegedKey(key: string): boolean {
  if (/^sb_secret_/.test(key)) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.role === 'service_role';
  } catch {
    return false;
  }
}

/** Non-fatal gaps worth logging at startup. */
export function configWarnings(config: ApiConfig): string[] {
  const warnings: string[] = [];
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) warnings.push('SUPABASE_SERVICE_ROLE_KEY is set but ignored; remove it from this service.');
  if (!config.geminiKey && !config.anthropicKey) {
    warnings.push('No AI provider configured (GEMINI_API_KEY + GEMINI_MODEL, or ANTHROPIC_API_KEY). Chat will report that the AI is unavailable.');
  }
  return warnings;
}
