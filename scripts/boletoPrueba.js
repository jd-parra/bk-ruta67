// Genera un boleto firmado con la llave de desarrollo, para probar HCE/NFC sin backend.
//
//   npm run boleto-prueba                          → Ana (estudiante), tramo sugerido 1
//   npm run boleto-prueba -- --telefono 04140000004 --tramo 2
//   npm run boleto-prueba -- --vencido             → ya vencido, para probar BOLETO_VENCIDO
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { aHex } from '../shared/bytes.js';
import { boletoARaw, calcularExpira, decodificarBoleto, firmarBoleto } from '../shared/boleto.js';
import { tarifaMaximaRed } from '../shared/tarifa.js';
import { LINEAS_SEMILLA, TABULADOR_SEMILLA, USUARIOS_SEMILLA } from '../src/bd/datosSemilla.js';
import { obtenerLlaves } from '../src/utils/llaves.js';

const SW_OK = '9000';
const DIA_MS = 24 * 60 * 60 * 1000;

const { values: opciones } = parseArgs({
  options: {
    telefono: { type: 'string', default: '04140000001' },
    tramo: { type: 'string', default: '1' },
    vencido: { type: 'boolean', default: false },
  },
});

const pasajero = USUARIOS_SEMILLA.find((u) => u.telefono === opciones.telefono);
if (!pasajero || pasajero.rol !== 'pasajero') {
  console.error(`No hay un pasajero semilla con teléfono ${opciones.telefono}`);
  process.exit(1);
}

const categoria = pasajero.categoriaVerificada ? pasajero.categoria : 'general';
const emitidoEn = opciones.vencido ? new Date(Date.now() - 8 * DIA_MS) : new Date();
const datos = {
  bid: randomUUID(),
  uid: pasajero.id,
  categoria,
  montoReservado: tarifaMaximaRed({
    lineas: LINEAS_SEMILLA,
    tabulador: TABULADOR_SEMILLA,
    categoria,
  }),
  expira: calcularExpira(emitidoEn),
};

const llaves = obtenerLlaves();
const boleto = firmarBoleto(datos, llaves.secreta);
const tramoSugerido = Number(opciones.tramo).toString(16).padStart(4, '0');

console.log(
  JSON.stringify(
    {
      pasajero: `${pasajero.nombre} (${categoria})`,
      ...decodificarBoletoLegible(boleto),
      llavePublica: llaves.publicaBase64url,
      raw: boletoARaw(boleto),
      hex: aHex(boleto),
      respuestaPedirBoletoHex: `${aHex(boleto)}${tramoSugerido}${SW_OK}`,
    },
    null,
    2,
  ),
);

function decodificarBoletoLegible(bytes) {
  const { bid, uid, categoria: cat, montoReservado, expira } = decodificarBoleto(bytes);
  return { bid, uid, categoria: cat, montoReservado, expira, expiraEn: new Date(expira * 1000) };
}
