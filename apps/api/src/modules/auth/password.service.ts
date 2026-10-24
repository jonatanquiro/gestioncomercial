import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { Errors } from '../../common/errors';
import { COMMON_PASSWORDS } from './common-passwords';

/** Argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, t=2, p=1). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Hash precalculado para igualar tiempos cuando el usuario no existe. */
  private dummyHash: Promise<string> = argon2.hash('contraseña-inexistente-para-tiempos', OPTIONS);

  async hash(password: string): Promise<string> {
    this.assertStrong(password);
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    if (!hash) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    return argon2.verify(hash, password).catch(() => false);
  }

  assertStrong(password: string) {
    const normalized = password.toLowerCase();
    if (COMMON_PASSWORDS.has(normalized) || /^(.)\1+$/.test(password) || /^\d+$/.test(password)) {
      throw Errors.validation([{ path: 'password', message: 'La contraseña es demasiado común. Elegí otra.' }]);
    }
  }
}
