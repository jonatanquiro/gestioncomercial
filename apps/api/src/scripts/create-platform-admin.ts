import 'reflect-metadata';
import { emailSchema, passwordSchema } from '@gc/contracts';
import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { authenticator } from 'otplib';
import { Pool } from 'pg';
import { encryptSecret } from '../common/crypto';
import { uuidv7 } from '../common/ids';
import { loadEnv } from '../config/env';
import { platformUsers } from '../db/schema';

/**
 * Crea un administrador de la plataforma con MFA obligatoria.
 * Uso: PLATFORM_ADMIN_PASSWORD='...' pnpm --filter @gc/api platform:create-admin email@dominio "Nombre"
 */
async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = emailSchema.parse(emailArg ?? '');
  const name = nameParts.join(' ').trim() || 'Administrador';
  const password = passwordSchema.parse(process.env.PLATFORM_ADMIN_PASSWORD ?? '');
  const env = loadEnv();

  const secret = authenticator.generateSecret();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE gc_platform`);
      await tx.insert(platformUsers).values({ id: uuidv7(), email, name, passwordHash, totpSecretEnc: encryptSecret(secret) });
    });
  } finally {
    await pool.end();
  }
  console.log(`Administrador creado: ${email}`);
  console.log('Cargá este código en tu app de autenticación (Google Authenticator, Authy, 1Password):');
  console.log(authenticator.keyuri(email, 'Gestión Comercial', secret));
  console.log(`Clave manual: ${secret}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
