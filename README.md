# Pasaje — backend

Backend del MVP Pasaje (Mérida). Qué expone la API: [`CONTRATO.md`](CONTRATO.md) y la referencia rápida [`docs/API.md`](docs/API.md) (con ejemplos en `mocks/`). Cómo se escribe: [`CONVENCIONES.md`](CONVENCIONES.md). Plan: [`docs/PLAN_FASE1.md`](docs/PLAN_FASE1.md).

## Arrancar

```bash
cp .env.example .env
npm install
npm run bd:levantar     # Postgres local en el puerto 5433 (para las pruebas)
npm run bd:reiniciar    # migraciones + semilla en la BD de .env (¡borra los datos!)
npm run dev             # http://localhost:3000/api/v1/salud
npm test                # siempre usa la BD local de pruebas
npm run demo            # flujo completo contra el backend corriendo (login → boletos → cobro → corrección)
npm run mocks           # regenera mocks/ con respuestas reales (BD local de pruebas)
```

Para usar Supabase, pon en `.env` la URL del **Transaction pooler** (puerto 6543) en `DATABASE_URL` y `PGSSL=true`.

## `shared/` para la app (Andy)

Copia la carpeta `shared/` tal cual a la app. Solo depende de `tweetnacl` y no usa APIs de Node.

| Archivo | Qué tiene |
|---|---|
| `boleto.js` | `firmarBoleto`, `decodificarBoleto`, `verificarFirma`, `validarBoletoParaCobro` (reglas del §8.3 en orden), `rawABoleto` / `boletoARaw` |
| `tarifa.js` | `calcularMonto` (domingo/feriado en hora de Venezuela), `tarifaMaximaRed`, `tabuladorVigente` |
| `bytes.js` | base64url, hex y UUID ↔ bytes sin `Buffer` |
| `codigos.js` | códigos de error, categorías, constantes del boleto y NFC |
| `vectores.json` | casos fijos: si tu código da otro resultado, está mal |
| `dev-keys.json` | llave de desarrollo (**solo pruebas**) |

### Boleto de prueba

```bash
npm run boleto-prueba                                   # Ana, estudiante, tramo sugerido 1
npm run boleto-prueba -- --telefono 04140000004 --tramo 2   # Pedro, general
npm run boleto-prueba -- --telefono 04140000005             # Rosa, exonerada (reserva 0)
npm run boleto-prueba -- --vencido                          # para probar BOLETO_VENCIDO
```

Imprime el `raw` (base64url), el `hex`, la `llavePublica` para verificarlo y `respuestaPedirBoletoHex`: la respuesta completa al `PEDIR_BOLETO` del §9 (boleto + tramo sugerido + `90 00`), lista para devolverla desde el HCE.
