# Pasaje — backend

Backend del MVP Pasaje (Mérida). Qué expone la API: [`CONTRATO.md`](CONTRATO.md) y la referencia rápida [`docs/API.md`](docs/API.md) (con ejemplos en `mocks/`). Cómo se escribe: [`CONVENCIONES.md`](CONVENCIONES.md). Plan: [`docs/PLAN_FASE1.md`](docs/PLAN_FASE1.md). Cómo probarlo: [`docs/GUIA_PRUEBAS.md`](docs/GUIA_PRUEBAS.md).

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
npm run bd:respaldo     # respaldo de la BD de .env en respaldos/ (hazlo antes de cambios grandes)
```

Para usar Supabase, pon en `.env` la URL del **Transaction pooler** (puerto 6543) en `DATABASE_URL` y `PGSSL=true`.

## `shared/` para la app (Andy)

Copia la carpeta `shared/` tal cual a la app. Solo depende de `tweetnacl` y no usa APIs de Node.

| Archivo | Qué tiene |
|---|---|
| `boleto.js` | `firmarBoleto`, `decodificarBoleto`, `verificarFirma`, `validarBoletoParaCobro` (reglas del §8.3 en orden), `rawABoleto` / `boletoARaw` |
| `tarifa.js` | `calcularMonto` (domingo/feriado en hora de Venezuela), `tarifaMaximaRed`, `tabuladorVigente` |
| `bytes.js` | base64url, hex y UUID ↔ bytes sin `Buffer` |
| `protocolo.js` | **NFC del §9**: `comandoSelect`, `comandoPedirBoleto`, `leerRespuestaPedirBoleto`, `comandoRecibo` (modo recolector) y `crearTarjetaHCE` (modo pasajero, devuelve el `ReciboLocal` listo para `/sync/recibos`). QR: `codificarQR` / `decodificarQR` |
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

## Desplegar (producción)

El backend necesita estar **siempre encendido** (Socket.IO y la tarea diaria de las 4 a. m.), con `https`.
El `Dockerfile` sirve para cualquier proveedor; `render.yaml` lo deja listo para Render.

1. **BD**: un proyecto de Supabase nuevo, solo para producción. Copia la URL del *Transaction pooler* (6543).
2. **Secretos**: `npm run secretos` imprime `JWT_SECRETO` y `LLAVE_FIRMA_BOLETOS`. Guárdalos en un gestor
   de contraseñas: si se pierde la llave de firma, los boletos emitidos dejan de valer.
3. **Servidor** (Render, plan gratis): *New > Blueprint* con este repo y llena `DATABASE_URL`, `JWT_SECRETO`,
   `LLAVE_FIRMA_BOLETOS` y `CORS_ORIGENES` (URL del panel). Al arrancar aplica las migraciones solo.
   El plan gratis se duerme tras 15 min sin uso: crea un monitor en UptimeRobot (gratis) que pida
   `https://<tu-servicio>.onrender.com/api/v1/salud` cada 10 min para mantenerlo despierto.
4. **Datos iniciales** (una vez, desde tu laptop, con un `.env.produccion` que tenga esas mismas variables y `NODE_ENV=production`):

   ```bash
   node --env-file=.env.produccion scripts/iniciarProduccion.js \
     --nombre "Central Mérida" --telefono 0414XXXXXXX --clave "una-clave-larga"
   ```

   Crea la cuenta de la central y carga tabulador, feriados y líneas del §13 (sin los usuarios de prueba).
   Las unidades y recolectores los crea la central (`POST /central/unidades`).

**Nunca** corras `npm run bd:semilla` contra producción (borra todo; además se niega si `NODE_ENV=production`).
