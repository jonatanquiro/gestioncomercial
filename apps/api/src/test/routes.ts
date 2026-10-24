import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { NO_CSRF_KEY, PERMISSION_KEY, PLATFORM_KEY, PUBLIC_KEY } from '../common/decorators';

export interface RouteInfo {
  method: string;
  path: string;
  isPublic: boolean;
  isPlatform: boolean;
  permissions: string[] | undefined;
}

const join = (...parts: Array<string | undefined>) =>
  '/' + parts.filter(Boolean).map((p) => p!.replace(/^\/|\/$/g, '')).filter(Boolean).join('/');

/** Recorre todos los controladores registrados: las pruebas cubren cada ruta nueva automáticamente. */
export function listRoutes(app: NestFastifyApplication): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
      if (!ctrl) continue;
      const base = Reflect.getMetadata(PATH_METADATA, ctrl) as string | undefined;
      const proto = ctrl.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (path === undefined || method === undefined) continue;
        const meta = <T>(key: string) => (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, ctrl)) as T | undefined;
        routes.push({
          method: RequestMethod[method],
          path: join(base, path),
          isPublic: Boolean(meta<boolean>(PUBLIC_KEY)),
          isPlatform: Boolean(meta<boolean>(PLATFORM_KEY)),
          permissions: meta<string[]>(PERMISSION_KEY),
        });
        void NO_CSRF_KEY;
      }
    }
  }
  return routes;
}

export function fillParams(path: string, value: string) {
  return path.replace(/:[A-Za-z]+/g, value);
}
