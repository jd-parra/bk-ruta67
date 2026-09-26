// Caché en memoria para datos que casi nunca cambian (tabuladores, líneas, feriados).
// Cada consulta a Supabase cuesta ~150 ms: leerlos en cada petición se nota.
// La central invalida al cambiarlos; el TTL cubre cambios hechos por fuera (SQL Editor, semilla).

const registradas = new Set();

/**
 * Envuelve una función asíncrona sin parámetros y guarda su resultado `ttlMs` milisegundos.
 * Peticiones simultáneas comparten la misma consulta.
 * @template T
 * @param {() => Promise<T>} cargar
 * @param {number} ttlMs
 * @returns {{ obtener: () => Promise<T>, invalidar: () => void }}
 */
export function memoizar(cargar, ttlMs) {
  let valor;
  let venceEn = 0;
  let enCurso = null;

  const cache = {
    async obtener() {
      if (Date.now() < venceEn) return valor;
      enCurso ??= cargar()
        .then((nuevo) => {
          valor = nuevo;
          venceEn = Date.now() + ttlMs;
          return nuevo;
        })
        .finally(() => {
          enCurso = null;
        });
      return enCurso;
    },
    invalidar() {
      venceEn = 0;
    },
  };
  registradas.add(cache);
  return cache;
}

/** Invalida todas las cachés (después de que la central cambia tarifas, líneas o unidades). */
export function invalidarCaches() {
  for (const cache of registradas) cache.invalidar();
}
