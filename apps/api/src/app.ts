import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { requestId } from './common/ids';
import { loadEnv } from './config/env';

export const API_PREFIX = 'api/v1';

/** Crea la aplicación (la usan main.ts y las pruebas de integración). */
export async function createApp(): Promise<NestFastifyApplication> {
  const env = loadEnv();
  const adapter = new FastifyAdapter({
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : requestId();
    },
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
          },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (req, reply) => {
    void reply.header('x-request-id', String(req.id));
    if (req.url.startsWith('/api/')) void reply.header('cache-control', 'no-store');
  });
  await app.register(fastifyCookie as never);
  await app.register(fastifyHelmet as never, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  } as never);

  // En producción la API sirve también la web compilada (un solo contenedor).
  const webDist = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : null;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic as never, { root: webDist, wildcard: false } as never);
    // Rutas de la SPA: cualquier GET fuera de /api devuelve index.html. El 404 general lo sigue manejando Nest.
    fastify.get('/*', (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Ruta no encontrada', requestId: String(req.id) });
      }
      void reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }
  return app;
}
