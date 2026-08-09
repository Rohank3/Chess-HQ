export function configureTestEnv(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to populate test env vars in production.');
  }

  const testDefaults: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '4123',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/chess_test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
    JWT_ACCESS_TTL: '15m',
    CLIENT_ORIGIN: 'http://localhost:5173',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX: '60',
    LOG_LEVEL: 'warn',
    DRAW_OFFER_TTL_MS: '30000',
  };

  for (const [key, value] of Object.entries(testDefaults)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

configureTestEnv();
