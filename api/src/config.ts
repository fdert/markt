import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/raseed',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES ?? '12h',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  zatca: {
    sandboxUrl: process.env.ZATCA_SANDBOX_URL ?? 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
    simulationUrl: process.env.ZATCA_SIMULATION_URL ?? 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
    productionUrl: process.env.ZATCA_PRODUCTION_URL ?? 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
  },
};
