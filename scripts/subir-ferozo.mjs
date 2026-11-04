// Sube por FTP el último paquete de dist/ferozo-* (generado con scripts/preparar-ferozo.ps1).
// Solo manda lo que cambió desde la última subida y borra lo que se subió antes y ya no existe.
//
//   node scripts/subir-ferozo.mjs              muestra qué se subiría, sin tocar el hosting
//   node scripts/subir-ferozo.mjs --confirmar  sube
//   node scripts/subir-ferozo.mjs --listar /   lista una carpeta del hosting
//
// Los datos de acceso se leen de %USERPROFILE%\.ferozo.env (fuera del repositorio):
//   FTP_HOST, FTP_USER, FTP_PASSWORD y, opcionales, FTP_PRIVADO y FTP_PUBLICO.
// Nunca sube un .env ni el contenido de storage/ (registros y archivos del servidor).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const repo = join(import.meta.dirname, '..');
const registro = join(repo, 'dist', 'ferozo-subidos.json');
const LOTE = 400;
const PARALELO = 4;

function leerAcceso() {
  const archivo = join(homedir(), '.ferozo.env');
  if (!existsSync(archivo)) throw new Error(`Falta ${archivo}. Crealo con FTP_HOST, FTP_USER y FTP_PASSWORD.`);
  const datos = {};
  for (const linea of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) datos[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  for (const k of ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD']) {
    if (!datos[k]) throw new Error(`Falta ${k} en ${archivo}`);
  }
  return {
    host: datos.FTP_HOST.replace(/^ftps?:\/\//, '').replace(/\/+$/, ''),
    user: datos.FTP_USER,
    password: datos.FTP_PASSWORD,
    privado: (datos.FTP_PRIVADO || '/gestion-comercial-servidor').replace(/\/+$/, ''),
    publico: (datos.FTP_PUBLICO || '/public_html/gestion-comercial').replace(/\/+$/, ''),
  };
}

function ultimoPaquete() {
  const dist = join(repo, 'dist');
  const paquetes = existsSync(dist) ? readdirSync(dist).filter((n) => /^ferozo-\d{8}-\d{6}$/.test(n)).sort() : [];
  if (!paquetes.length) throw new Error('No hay paquetes en dist/. Correr primero scripts/preparar-ferozo.ps1.');
  return join(dist, paquetes.at(-1));
}

function archivos(base) {
  const lista = [];
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      const rel = relative(base, ruta).split(sep).join('/');
      if (nombre === '.env' || rel === 'storage' || rel.startsWith('storage/')) continue;
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else lista.push({ local: ruta, rel });
    }
  };
  recorrer(base);
  return lista;
}

const hash = (ruta) => createHash('sha1').update(readFileSync(ruta)).digest('hex');
const url = (acceso, remoto) => `ftp://${acceso.host}${remoto.split('/').map(encodeURIComponent).join('/')}`;
const comillas = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Corre curl con un archivo de configuración temporal, así la contraseña no queda en la línea de comandos. */
function curl(acceso, lineas, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ferozo-'));
  const config = join(dir, 'curl.cfg');
  try {
    writeFileSync(config, [`user = ${comillas(`${acceso.user}:${acceso.password}`)}`, 'ssl-reqd', 'silent', 'show-error', ...lineas].join('\n'), { mode: 0o600 });
    return spawnSync('curl.exe', ['-K', config, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function listar(acceso, carpeta) {
  const res = curl(acceso, [`url = ${comillas(url(acceso, carpeta.replace(/\/?$/, '/')))}`]);
  if (res.status !== 0) throw new Error(`No se pudo listar ${carpeta}: ${res.stderr.trim()}`);
  console.log(res.stdout);
}

function main() {
  const args = process.argv.slice(2);
  const acceso = leerAcceso();
  if (args[0] === '--listar') return listar(acceso, args[1] ?? '/');

  const paquete = ultimoPaquete();
  const locales = [
    ...archivos(join(paquete, 'gestion-comercial-servidor')).map((a) => ({ ...a, remoto: `${acceso.privado}/${a.rel}` })),
    ...archivos(join(paquete, 'gestion-comercial')).map((a) => ({ ...a, remoto: `${acceso.publico}/${a.rel}` })),
  ];
  // Primero el servidor y los recursos; al final los index, para no publicar una web que pida archivos que todavía no están.
  const peso = (a) => (a.remoto.startsWith(acceso.publico) ? 1 : 0) + (/(^|\/)index\.(html|php)$/.test(a.rel) ? 2 : 0);
  locales.sort((a, b) => peso(a) - peso(b) || a.remoto.localeCompare(b.remoto));

  const subidos = existsSync(registro) ? JSON.parse(readFileSync(registro, 'utf8')) : {};
  for (const a of locales) a.hash = hash(a.local);
  const cambios = locales.filter((a) => subidos[a.remoto] !== a.hash);
  const presentes = new Set(locales.map((a) => a.remoto));
  const sobrantes = Object.keys(subidos).filter((r) => !presentes.has(r) && (r.startsWith(`${acceso.privado}/`) || r.startsWith(`${acceso.publico}/`)));
  const migraciones = cambios.filter((a) => a.rel.startsWith('database/migrations/'));

  console.log(`Paquete: ${relative(repo, paquete)}`);
  console.log(`Destino: ftp://${acceso.host} · privado ${acceso.privado} · público ${acceso.publico}`);
  console.log(`Para subir: ${cambios.length} de ${locales.length} archivos. Para borrar: ${sobrantes.length}.`);
  for (const a of cambios.slice(0, 25)) console.log(`  + ${a.remoto}`);
  if (cambios.length > 25) console.log(`  … y ${cambios.length - 25} más`);
  for (const r of sobrantes.slice(0, 25)) console.log(`  - ${r}`);
  if (migraciones.length) console.log(`Hay ${migraciones.length} migración(es) nueva(s) o cambiada(s): la base del hosting se actualiza aparte.`);
  if (!args.includes('--confirmar')) {
    console.log('\nNo se subió nada. Para subir: node scripts/subir-ferozo.mjs --confirmar');
    return;
  }

  /** Sube varios archivos con una sola llamada a curl y devuelve los que no llegaron (226 = recibido). */
  const subir = (lote, paralelo) => {
    const lineas = ['ftp-create-dirs', 'write-out = "%{url}\\t%{response_code}\\n"'];
    if (paralelo) lineas.push('parallel', `parallel-max = ${PARALELO}`);
    for (const a of lote) lineas.push(`upload-file = ${comillas(a.local)}`, `url = ${comillas(url(acceso, a.remoto))}`);
    const resultado = new Map(curl(acceso, lineas).stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t')));
    return lote.filter((a) => resultado.get(url(acceso, a.remoto)) !== '226');
  };

  let errores = 0;
  for (let i = 0; i < cambios.length; i += LOTE) {
    const lote = cambios.slice(i, i + LOTE);
    // El FTP de Ferozo a veces corta una transferencia cifrada (426): se reintenta de a un archivo.
    let fallidos = subir(lote, true);
    for (let intento = 0; intento < 3 && fallidos.length; intento++) fallidos = fallidos.filter((a) => subir([a], false).length);
    const fallaron = new Set(fallidos);
    for (const a of lote) if (!fallaron.has(a)) subidos[a.remoto] = a.hash;
    for (const a of fallidos) console.error(`  No se subió ${a.remoto}`);
    errores += fallidos.length;
    writeFileSync(registro, JSON.stringify(subidos, null, 1));
    console.log(`Subidos ${Math.min(i + LOTE, cambios.length)} de ${cambios.length}`);
  }

  if (sobrantes.length && !errores) {
    for (let i = 0; i < sobrantes.length; i += LOTE) {
      const lote = sobrantes.slice(i, i + LOTE);
      const lineas = [`url = ${comillas(url(acceso, '/'))}`, 'list-only', 'output = "nul"', ...lote.map((r) => `quote = ${comillas(`*DELE ${r}`)}`)];
      const res = curl(acceso, lineas);
      if (res.status === 0) for (const r of lote) delete subidos[r];
      else console.error(`No se pudieron borrar algunos archivos viejos: ${res.stderr.trim()}`);
    }
    writeFileSync(registro, JSON.stringify(subidos, null, 1));
  }
  console.log(errores ? `\nTerminó con ${errores} archivo(s) sin subir: volver a correr para reintentar.` : '\nSubida completa.');
  process.exitCode = errores ? 1 : 0;
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
