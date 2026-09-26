// POST /sync/recibos (CONTRATO.md §6.4) y GET /me/frecuentes (§6.2).
// El pasajero sube los recibos que recibió por NFC (paso 3 del §9). Si su recibo llega antes
// que el cobro del recolector, el cobro se crea con el recibo.
import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { conTransaccion, pool } from '../../bd/pool.js';
import { lineasParaTarifas } from '../lineas/servicio.js';
import * as unidades from '../unidades/repositorio.js';
import { feriadosRecientes, vigenteYProximo } from '../tabuladores/servicio.js';
import { completarDespuesDelCommit, rechazado, registrarUso } from './nucleo.js';

/**
 * @param {object} pasajero fila de BD
 * @param {object[]} recibos ReciboLocal[]
 * @returns {Promise<{ resultados: object[] }>}
 */
export async function sincronizarRecibos(pasajero, recibos) {
  const [lineas, { todos }, feriados] = await Promise.all([
    lineasParaTarifas(),
    vigenteYProximo(),
    feriadosRecientes(),
  ]);
  const contexto = { pasajero, lineas, tabuladores: todos, feriados, unidades: new Map() };
  const resultados = [];
  for (const recibo of recibos) {
    resultados.push(await procesarRecibo(contexto, recibo));
  }
  return { resultados };
}

async function procesarRecibo(contexto, recibo) {
  const { bid } = recibo;
  const unidad = await buscarUnidad(contexto, recibo.unidadCodigo);
  if (!unidad?.recolector_id) return rechazado(bid, CODIGOS_ERROR.VALIDACION);

  const linea = contexto.lineas.find((l) => l.codigo === recibo.lineaCodigo);
  const tramo = linea?.tramos.find((t) => t.codigo === recibo.tramoCodigo);
  if (!tramo || linea.id !== unidad.linea_id) return rechazado(bid, CODIGOS_ERROR.TRAMO_INVALIDO);

  const resultado = await conTransaccion((cliente) =>
    registrarUso(cliente, {
      bid,
      origen: 'pasajero',
      pasajeroId: contexto.pasajero.id,
      recolectorId: unidad.recolector_id,
      unidad,
      linea,
      tramo,
      tabuladores: contexto.tabuladores,
      feriados: contexto.feriados,
      montoReportado: recibo.monto,
      metodo: 'nfc', // el QR no tiene paso 3: solo hay recibos por NFC
      ocurridoEn: recibo.ocurridoEn,
    }),
  );
  return completarDespuesDelCommit(resultado);
}

/** Unidades por código, consultadas una vez por sincronización. */
async function buscarUnidad(contexto, codigo) {
  if (!contexto.unidades.has(codigo)) {
    contexto.unidades.set(codigo, await unidades.buscarPorCodigo(pool, codigo));
  }
  return contexto.unidades.get(codigo);
}

/**
 * Tramos que más usa el pasajero, para restaurar las rutas frecuentes si reinstala la app.
 * @param {string} pasajeroId
 * @returns {Promise<{ lineaCodigo: number, tramoCodigo: number, veces: number }[]>}
 */
export async function frecuentesDe(pasajeroId) {
  const { rows } = await pool.query(
    `SELECT linea_codigo, tramo_codigo, count(*)::int AS veces
     FROM pasaje.cobros WHERE pasajero_id = $1 AND anulado_en IS NULL
     GROUP BY linea_codigo, tramo_codigo
     ORDER BY veces DESC, linea_codigo, tramo_codigo`,
    [pasajeroId],
  );
  return rows.map((r) => ({
    lineaCodigo: r.linea_codigo,
    tramoCodigo: r.tramo_codigo,
    veces: r.veces,
  }));
}
