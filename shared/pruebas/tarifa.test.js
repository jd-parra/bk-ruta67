import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calcularMonto,
  esDomingoOFeriado,
  fechaVenezuela,
  tabuladorVigente,
  tarifaCompleta,
  tarifaMaximaRed,
} from '../tarifa.js';

const vectores = JSON.parse(readFileSync(new URL('../vectores.json', import.meta.url)));
const { tabuladores, feriados } = vectores;

for (const caso of vectores.montos) {
  test(`monto: ${caso.caso}`, () => {
    const monto = calcularMonto({
      linea: { tipo: caso.linea },
      tramo: caso.tramo,
      tabulador: tabuladores[caso.tabulador],
      categoria: caso.categoria,
      ocurridoEn: caso.ocurridoEn,
      feriados,
    });
    assert.equal(monto, caso.monto);
    assert.ok(Number.isInteger(monto));
  });
}

test('fechaVenezuela resta 4 horas', () => {
  assert.deepEqual(fechaVenezuela('2026-09-28T01:00:00Z'), { fecha: '2026-09-27', diaSemana: 0 });
  assert.deepEqual(fechaVenezuela('2026-09-28T04:00:00Z'), { fecha: '2026-09-28', diaSemana: 1 });
  assert.throws(() => fechaVenezuela('no es fecha'));
});

test('esDomingoOFeriado usa la fecha local (feriado un miércoles)', () => {
  const miercoles = ['2026-10-14'];
  assert.equal(esDomingoOFeriado('2026-10-15T03:59:00Z', miercoles), true); // 14/10 23:59 VE
  assert.equal(esDomingoOFeriado('2026-10-14T04:00:00Z', miercoles), true); // 14/10 00:00 VE
  assert.equal(esDomingoOFeriado('2026-10-14T03:59:00Z', miercoles), false); // 13/10 23:59 VE
  assert.equal(esDomingoOFeriado('2026-10-15T04:00:00Z', miercoles), false); // 15/10 00:00 VE
});

test('tarifaCompleta: fuera de la escala suburbana lanza error', () => {
  const tabulador = { ...tabuladores.semilla, suburbano: [{ hastaKm: 10, monto: 28000 }] };
  assert.throws(() => tarifaCompleta({ tipo: 'suburbana' }, { km: 11 }, tabulador));
});

test('tarifaCompleta: la escala funciona aunque venga desordenada', () => {
  const tabulador = {
    ...tabuladores.semilla,
    suburbano: [...tabuladores.semilla.suburbano].reverse(),
  };
  assert.equal(tarifaCompleta({ tipo: 'suburbana' }, { km: 3 }, tabulador), 28000);
});

test('tarifaCompleta: tarifaManual 0 también gana', () => {
  const completa = tarifaCompleta(
    { tipo: 'urbana' },
    { km: 5, tarifaManual: 0 },
    tabuladores.semilla,
  );
  assert.equal(completa, 0);
});

test('tarifaMaximaRed incluye recargo y descuento de la categoría', () => {
  const lineas = [
    { tipo: 'urbana', tramos: [{ km: 5 }] },
    { tipo: 'suburbana', tramos: [{ km: 9 }, { km: 25 }] },
  ];
  const { semilla, conRecargo } = tabuladores;
  assert.equal(tarifaMaximaRed({ lineas, tabulador: semilla, categoria: 'general' }), 99000);
  assert.equal(tarifaMaximaRed({ lineas, tabulador: semilla, categoria: 'estudiante' }), 49500);
  assert.equal(tarifaMaximaRed({ lineas, tabulador: semilla, categoria: 'exonerado' }), 0);
  assert.equal(tarifaMaximaRed({ lineas, tabulador: conRecargo, categoria: 'general' }), 118800);
});

test('tabuladorVigente elige el más reciente que ya empezó', () => {
  const lista = [tabuladores.conRecargo, tabuladores.semilla];
  assert.equal(tabuladorVigente(lista, '2026-09-15T00:00:00Z'), tabuladores.semilla);
  assert.equal(tabuladorVigente(lista, '2026-10-01T04:00:00Z'), tabuladores.conRecargo);
  assert.equal(tabuladorVigente(lista, '2026-08-01T00:00:00Z'), null);
});
