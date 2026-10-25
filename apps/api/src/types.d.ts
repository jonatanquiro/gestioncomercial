import type { Actor, PlatformActor } from './common/actor';

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
    platformActor?: PlatformActor;
  }
}
