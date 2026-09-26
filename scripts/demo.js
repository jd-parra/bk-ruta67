// Demo de punta a punta contra un backend corriendo (simula las dos apps).
//   npm run demo                       → usa http://localhost:$PORT
//   npm run demo -- --base http://192.168.1.50:3001
// Deja datos de prueba (una recarga, un boleto y un cobro anulado) en la BD a la que apunte.
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';
import { decodificarBoleto, validarBoletoParaCobro } from '../shared/boleto.js';
import {
  comandoPedirBoleto,
  comandoRecibo,
  comandoSelect,
  crearTarjetaHCE,
  esOk,
  leerRespuestaPedirBoleto,
} from '../shared/protocolo.js';
import { desdeBase64url } from '../shared/bytes.js';
import { calcularMonto } from '../shared/tarifa.js';
import { formatearBs } from '../src/utils/dinero.js';

const { values } = parseArgs({
  options: { base: { type: 'string', default: `http://localhost:${process.env.PORT ?? 3000}` } },
});
const BASE = values.base.replace(/\/$/, '');
const API = `${BASE}/api/v1`;

const paso = (texto) => console.log(`\n▶ ${texto}`);
const ok = (texto) => console.log(`  ✓ ${texto}`);

async function llamar(metodo, ruta, { token, cuerpo } = {}) {
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: cuerpo && JSON.stringify(cuerpo),
  });
  const datos = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${metodo} ${ruta} → ${res.status} ${JSON.stringify(datos)}`);
  return datos;
}

const login = async (telefono) =>
  (await llamar('POST', '/auth/login', { cuerpo: { telefono, clave: '1234' } })).token;

async function main() {
  paso(`Conectando a ${API}`);
  const salud = await llamar('GET', '/salud');
  ok(`API viva, BD: ${salud.bd}`);

  paso('Login de Ana (pasajera) y Luis (recolector, unidad 101)');
  const [ana, luis] = await Promise.all([login('04140000001'), login('04140000002')]);
  ok('tokens recibidos');

  paso('Ana abre la app: se conecta al tiempo real');
  const socket = io(BASE, { auth: { token: ana }, transports: ['websocket'] });
  await new Promise((listo, error) => {
    socket.once('connect', listo);
    socket.once('connect_error', error);
  });
  const cobroEnVivo = new Promise((listo) => socket.once('cobro:confirmado', listo));
  ok('socket conectado');

  paso('Ana recarga 200,00 Bs y pide un boleto');
  await llamar('POST', '/recargas', { token: ana, cuerpo: { monto: 20000, metodo: 'simulada' } });
  const { boletos, billetera } = await llamar('POST', '/boletos', {
    token: ana,
    cuerpo: { cantidad: 1 },
  });
  const boleto = boletos[0] ?? (await llamar('GET', '/boletos', { token: ana }))[0];
  ok(`boleto ${boleto.bid.slice(0, 8)}… reserva ${formatearBs(boleto.montoReservado)}`);
  ok(`saldo disponible ${formatearBs(billetera.saldoDisponible)}`);

  paso('Luis abre "Cobrar": descarga el paquete');
  const paquete = await llamar('GET', '/recolector/paquete', { token: luis });
  ok(`unidad ${paquete.unidad.codigo}, línea "${paquete.linea.nombre}"`);

  paso('Ana abre "Pagar" y acerca el teléfono: toque NFC (protocolo del §9, shared/)');
  const recibosDeAna = [];
  const tarjetaAna = crearTarjetaHCE({
    pagarAbierta: () => true,
    siguienteBoleto: () => ({ raw: boleto.raw, tramoSugerido: 0 }),
    alRecibo: (recibo) => recibosDeAna.push(recibo),
  });
  if (!esOk(tarjetaAna.procesar(comandoSelect()))) throw new Error('SELECT falló');
  const leido = leerRespuestaPedirBoleto(
    tarjetaAna.procesar(
      comandoPedirBoleto({
        lineaCodigo: paquete.linea.codigo,
        unidadCodigo: paquete.unidad.codigo,
      }),
    ),
  );
  if (!leido.ok) throw new Error(`PEDIR_BOLETO falló: ${leido.motivo}`);
  ok('SELECT → 90 00 · PEDIR_BOLETO → boleto de 106 bytes');

  // Sin tramo sugerido: el recolector usa el más frecuente de la línea (el primero del paquete).
  const tramo =
    paquete.linea.tramos.find((t) => t.codigo === leido.tramoSugerido) ?? paquete.linea.tramos[0];
  const ocurridoEn = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const revocados = new Set(paquete.revocados);
  // La categoría viene dentro del boleto: se lee primero para calcular el monto, y luego
  // se valida con ese monto (las 4 reglas del §8.3, en orden).
  const { categoria } = decodificarBoleto(leido.boleto);
  const monto = calcularMonto({
    linea: paquete.linea,
    tramo,
    tabulador: paquete.tabulador,
    categoria,
    ocurridoEn,
    feriados: paquete.feriados,
  });
  const validacion = validarBoletoParaCobro(leido.boleto, {
    llavePublica: desdeBase64url(paquete.llavePublica),
    ahoraSeg: Math.floor(Date.now() / 1000),
    monto,
    yaUsado: (bid) => revocados.has(bid),
  });
  if (!validacion.ok) throw new Error(`el recolector rechazó el boleto: ${validacion.codigo}`);
  ok(
    `Luis valida SIN internet: firma válida · ${validacion.boleto.categoria} · "${tramo.nombre}" · ${formatearBs(monto)}`,
  );

  const reciboApdu = comandoRecibo({
    bid: validacion.boleto.bid,
    tramoCodigo: tramo.codigo,
    monto,
    ocurridoEn,
  });
  if (!esOk(tarjetaAna.procesar(reciboApdu))) throw new Error('RECIBO falló');
  ok(`RECIBO → 90 00 · el teléfono de Ana guardó ${recibosDeAna.length} recibo`);

  paso('Luis sincroniza el cobro');
  const { resultados } = await llamar('POST', '/sync/cobros', {
    token: luis,
    cuerpo: {
      cobros: [{ raw: leido.raw, tramoCodigo: tramo.codigo, monto, metodo: 'nfc', ocurridoEn }],
    },
  });
  const [resultado] = resultados;
  ok(`estado: ${resultado.estado} · cobrado ${formatearBs(resultado.cobro.monto)}`);

  paso('El teléfono de Ana recibe el cobro en vivo');
  const evento = await Promise.race([
    cobroEnVivo,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('no llegó el evento')), 5000)),
  ]);
  ok(`cobro:confirmado → saldo disponible ${formatearBs(evento.billetera.saldoDisponible)}`);

  paso('Ana sube su recibo (fase 2): confirma el mismo cobro');
  const sync = await llamar('POST', '/sync/recibos', {
    token: ana,
    cuerpo: { recibos: recibosDeAna },
  });
  ok(
    `estado: ${sync.resultados[0].estado} · confirmado por ${sync.resultados[0].cobro.confirmadoPor.join(' y ')}`,
  );

  paso('Luis se equivocó de tramo: "Corregir" dentro de 2 minutos');
  await llamar('DELETE', `/sync/cobros/${boleto.bid}`, { token: luis });
  const despues = await llamar('GET', '/billetera', { token: ana });
  ok(`cobro anulado · el boleto vuelve · ${despues.boletosActivos} boletos activos`);

  socket.close();
  console.log('\n✅ Demo completa\n');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exit(1);
});
