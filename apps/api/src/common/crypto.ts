import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../config/env';

/** Token aleatorio para cookies y enlaces (256 bits). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Los tokens se guardan hasheados: una fuga de la base no permite usar sesiones. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM con la clave maestra APP_ENCRYPTION_KEY. Formato: iv.tag.datos (base64url). */
export function encryptSecret(plain: string): string {
  const key = Buffer.from(loadEnv().APP_ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const key = Buffer.from(loadEnv().APP_ENCRYPTION_KEY, 'base64');
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Secreto cifrado con formato inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
