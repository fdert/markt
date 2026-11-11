import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
export const db = drizzle(pool, { schema });
export type DB = NodePgDatabase<typeof schema>;
// نوع المعاملة يقبل قاعدة البيانات أو معاملة داخلها
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;
export { schema };
