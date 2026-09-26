# Plan — Backend Pasaje, fase 1

## Contexto

Repo `bk-ruta67` = **solo backend y lógica** del MVP descrito en `CONTRATO.md` (pagos de transporte en Mérida con boletos firmados Ed25519 y NFC). Hoy el repo solo tiene `CONTRATO.md` y `CONVENCIONES.md` (en inglés/mixto). Objetivo de la fase 1: que Andy (app) y Jose (pantallas/panel) puedan conectarse a una API real y lograr el **hito: primer cobro real teléfono a teléfono con tramo sugerido y recibo**.

Decisiones tomadas con el usuario:
- **Todo en español**: código, archivos, tablas, columnas, comentarios, commits.
- **Base de datos: Supabase (PostgreSQL gratis)**. En desarrollo, Postgres local con Docker; mismo código, cambia `DATABASE_URL`.
- **Tiempo real: Socket.IO completo como el contrato (§11)**, servido por el mismo Express.

### ¿Por qué Socket.IO y no Supabase Realtime?
Supabase Realtime exigiría que las apps hablen directo con la BD usando Auth/RLS de Supabase; nuestro auth es JWT propio (teléfono + clave) y el contrato ya fija Socket.IO. Además los eventos nacen en el backend (después de verificar firma y cobrar), así que emitirlos desde Express es lo natural. **Supabase = solo Postgres.** Notificaciones push con la app cerrada no entran en fase 1 (fase 2: Expo Push, gratis).

### Hosting fase 1
Backend en la laptop de Juan, en la red local (`http://<ip-local>:3000/api/v1`, como dice el contrato), apuntando a Supabase. Así los datos sobreviven y los demás pueden ver la BD en el panel de Supabase. Deploy (Render free) queda opcional.

Conexión a Supabase: **Transaction pooler** (puerto 6543, IPv4) con `ssl`. La conexión directa es solo IPv6 y el Session pooler (5432) se queda colgado desde nuestra red. Consecuencias en CONVENCIONES.md §7.

---

## Estructura del repo

```
shared/                 ← JS puro, lo copia la app (sin Buffer, crypto de Node ni fs)
  boleto.js             ← codificar / decodificar / firmar / verificar (106 bytes), base64url
  tarifa.js             ← calcularTarifa(), esDomingoOFeriado() en America/Caracas, tarifaMaximaRed()
  codigos.js            ← códigos de error, categorías (0/1/2), constantes de protocolo
  dev-keys.json         ← llave Ed25519 de desarrollo
  package.json          ← única dependencia: tweetnacl
src/
  app.js                ← Express sin listen (para tests)
  servidor.js           ← http + Socket.IO + listen + jobs
  config/index.js       ← único lugar que lee process.env (validado con zod)
  bd/pool.js            ← pool pg + conTransaccion(fn)
  bd/migraciones/       ← node-pg-migrate
  bd/semilla.js         ← datos del §13
  middlewares/          ← autenticar, exigirRol, validar, manejadorErrores
  modulos/<modulo>/     ← rutas.js, controlador.js, servicio.js, repositorio.js, esquemas.js, serializadores.js
  tiempoReal/           ← socket.js (auth JWT + salas), eventos.js, emisor.js (inyectable)
  trabajos/             ← vencerBoletos.js
  utils/                ← ErrorApp, helpers
scripts/boletoPrueba.js ← npm run boleto-prueba
pruebas/
docker-compose.yml      ← Postgres 17 local (igual que Supabase)
.env.example
```

Módulos: `auth`, `billetera`, `recargas`, `boletos`, `lineas`, `tabuladores`, `recolector`, `sincronizacion`, `ubicaciones`, `central`, `publico`, `mapa`.

Stack: Node ≥ 20 ESM, Express 5, Socket.IO 4, `pg`, `node-pg-migrate`, `zod`, `jsonwebtoken`, `bcryptjs`, `tweetnacl`, `pino`, `node-cron`, `node:test` + `supertest`, Prettier + ESLint.

---

## Esquema de base de datos (español, snake_case)

| Tabla | Columnas clave |
|---|---|
| `usuarios` | id, nombre, telefono UNIQUE, clave_hash, rol, categoria, categoria_verificada, bloqueado, creado_en |
| `billeteras` | usuario_id PK, saldo_disponible BIGINT ≥0, saldo_reservado BIGINT ≥0 |
| `movimientos` | id, usuario_id, tipo (recarga/reserva/cobro/liberacion), monto, saldo_disponible_despues, cobro_id?, boleto_bid?, creado_en — **solo inserción** |
| `recargas` | id, usuario_id, monto, metodo, estado, creado_en |
| `tabuladores` | id, fuente, vigente_desde, descuentos JSONB, recargo_domingo_feriado NUMERIC, urbano_minimo BIGINT, suburbano JSONB |
| `feriados` | fecha DATE PK, nombre |
| `lineas` | id, codigo INTEGER UNIQUE CHECK 1–65535, nombre, tipo |
| `tramos` | id, linea_id, codigo, nombre, km NUMERIC, tarifa_manual BIGINT? — UNIQUE(linea_id, codigo) |
| `unidades` | id, codigo UNIQUE, placa UNIQUE, linea_id, recolector_id UNIQUE? |
| `boletos` | bid PK, usuario_id, categoria, monto_reservado, expira_en, estado (activo/usado/revocado/vencido), creado_en |
| `cobros` | id, bid, pasajero_id, recolector_id, unidad_id, tramo_id, categoria_aplicada, monto, monto_recolector, metodo, ocurrido_en, sincronizado_en, confirmado_por TEXT[], anulado_en? — **índice UNIQUE parcial en bid WHERE anulado_en IS NULL** |
| `conflictos` | id, bid, cobro_original_id, recolector_id, unidad_id, ocurrido_en, creado_en (el 2.º uso de un bid va aquí, así el UNIQUE se mantiene) |
| `ubicaciones_unidad` | unidad_id PK, lat, lng, actualizado_en (upsert, solo la última) |
| `avisos` | id, usuario_id? (null = global), tipo, mensaje, vigente_desde, creado_en |

`frecuencia` de un tramo = `COUNT(cobros)` de los últimos 30 días, calculada al leer (no columna).

---

## Reglas de negocio clave

**Emisión (`POST /boletos`)** — en transacción con la billetera bloqueada (`FOR UPDATE`): `montoReservado = tarifaMaximaRed(tabulador vigente, categoría verificada, con recargo)`; se emiten `min(cantidad, 5 − activos, floor(disponible / montoReservado))`; por boleto: `disponible −= r`, `reservado += r`, movimiento `reserva (−r)`. Categoría sin verificar → se firma como general (0). Si ninguno alcanza → `422 SALDO_INSUFICIENTE`.

**`POST /sync/cobros`** — por cada cobro, en este orden:
1. Firma inválida → `rechazado BOLETO_INVALIDO`
2. `expira < ocurridoEn − 10 min` → `rechazado BOLETO_VENCIDO`
3. Boleto revocado → `rechazado BOLETO_USADO`
4. Ya existe cobro vigente con ese bid: mismo recolector + mismo `ocurridoEn` → `duplicado` (devuelve el cobro); distinto → `conflicto`: se inserta en `conflictos`, se bloquea la cuenta, se revocan sus boletos activos (liberando la reserva) y se emite `paquete:actualizado`
5. Tramo fuera de la línea de la unidad del recolector → `rechazado TRAMO_INVALIDO`
6. `monto = calcularTarifa(tabulador vigente en ocurridoEn, feriados, categoría del boleto)`; si `> montoReservado` → `rechazado BOLETO_INSUFICIENTE` (gana el cálculo del backend sobre el `monto` del recolector)
7. Transacción: se inserta el cobro, boleto → `usado`, `reservado −= r`, `disponible += (r − monto)`, movimientos `cobro` y `liberacion`. Se emite `cobro:confirmado` a `usuario:<pasajeroId>`.

**`DELETE /sync/cobros/:bid`** — solo el recolector dueño y con < 2 min desde `sincronizado_en`: marca `anulado_en`, boleto → `activo`, vuelve a reservar la diferencia (movimiento `reserva`).

**Paquete del recolector** — llavePublica, unidad, línea con tramos ordenados por frecuencia, tabulador vigente y próximo, feriados, `revocados` (revocados sin vencer + activos de cuentas bloqueadas) y generadoEn.

**Job diario (node-cron, y también al arrancar)** — boletos activos vencidos → `vencido` y se libera la reserva.

---

## Tiempo real (§11)

- Handshake con `auth.token` (el mismo JWT); si es inválido, se rechaza.
- Salas: `usuario:<id>`, `central`. Internamente también `rol:pasajero` y `rol:recolector`, para los eventos masivos.
- `cobro:confirmado` → `usuario:<id>` · `unidad:ubicacion` → todos · `tarifa:aviso` → `rol:pasajero` (al crear un tabulador; también se guarda en `avisos`) · `paquete:actualizado` → `rol:recolector` (cambios de tabulador, líneas, unidades, revocaciones y bloqueos).
- Los servicios emiten por `tiempoReal/emisor.js`; en las pruebas se reemplaza por un espía.

---

## Pasos (en orden; un PR por paso)

> ✅ **Fase 1 completa** (26/09/2026): pasos 0 a 13 implementados, 139 pruebas y `npm run demo` de punta a punta contra Supabase. Referencia de la API: `docs/API.md`. Decisiones que llenan huecos del contrato: `CONTRATO.md` §19.

| # | Paso | Listo cuando |
|---|---|---|
| 0 | Reescribir `CONVENCIONES.md` todo en español y con Supabase; `package.json`, Prettier, ESLint, docker-compose, `.env.example`, config, `app.js`/`servidor.js`, `ErrorApp` + `manejadorErrores`, `GET /api/v1/salud`. Primer commit y push | `npm run dev` responde; `main` en GitHub |
| 1 | `shared/`: boleto.js, tarifa.js, codigos.js, dev-keys.json + pruebas con vectores fijos | pruebas en verde |
| 2 | `npm run boleto-prueba` (imprime base64url y hex) → **avisar a Andy** | Andy prueba HCE con un boleto real |
| 3 | Migraciones + semilla §13 (`npm run bd:reiniciar`); crear proyecto Supabase y probar contra él | los 6 usuarios, 3 líneas y las unidades 101 (urbana) y 102 (suburbana) existen |
| 4 | Auth: registro, login, `/me`, `autenticar`, `exigirRol`, `CUENTA_BLOQUEADA` | login de los usuarios semilla |
| 5 | Billetera, recargas simuladas, movimientos | recarga → saldo + movimiento |
| 6 | Líneas, tabulador, `/publico/tarifas` | montos = `shared/tarifa.js` |
| 7 | Boletos: emitir, listar, revocar | 5 boletos, reservado cuadrado |
| 8 | `GET /recolector/paquete` | el recolector puede cobrar sin conexión |
| 9 | `/sync/cobros`, `DELETE /sync/cobros/:bid`, `GET /recolector/cobros` | **Hito** |
| 10 | Socket.IO completo (4 eventos) | el pasajero ve el cobro en vivo |
| 11 | `POST /ubicaciones`, `GET /mapa/unidades` (últimos 5 min) | la unidad se mueve en el panel |
| 12 | Central: resumen, tabuladores, líneas y tramos (CRUD + tarifaManual), unidades, categorías pendientes, conflictos, bloqueo | Jose conecta el panel |
| 13 | Job de vencimiento | prueba que libera la reserva |

Después de cada paso con endpoints: dejar un ejemplo en `mocks/<endpoint>.json` (forma exacta del contrato) para Jose.

Fuera de fase 1: `/sync/recibos`, `/me/frecuentes`, QR, push.

---

## Puntos del contrato a confirmar con el equipo (resueltos, ver CONTRATO.md §19)

1. **Movimiento `cobro`**: el cobro sale de lo reservado, no del disponible, así que su `monto` sería 0 (propuesta: `monto = 0`, con `cobroId`; la diferencia va en `liberacion`).
2. **Exonerado**: `tarifaReferencia = 0` hace que `viajesEstimados` divida entre cero (propuesta: `null` = ilimitado).
3. **Registro con `rol`**: cualquiera podría registrarse como `central` (propuesta: el registro solo acepta `pasajero`; recolector y central, por semilla o por la central).
4. `/shared` vive en este repo: la app lo **copia** tal cual; cualquier cambio se avisa en el grupo.

---

## Verificación

- `npm test`: `shared` (vectores), dinero (recarga → emisión → cobro → liberación → vencimiento, con saldos que cuadran), sync (ok, duplicado, conflicto + bloqueo, cada `BOLETO_*`, `TRAMO_INVALIDO`), anular dentro y fuera de los 2 min, forma de las respuestas contra el contrato.
- Flujo manual con `curl` o un archivo `.http`: login de Ana → recarga 100000 → `POST /boletos` → tomar un `raw` → login de Luis → `GET /recolector/paquete` → `POST /sync/cobros` → verificar que la billetera de Ana liberó la diferencia (estudiante: 10000) y que llegó `cobro:confirmado` (script cliente `socket.io-client`).
- Repetir el mismo `POST /sync/cobros` → `duplicado`; con otro `ocurridoEn` → `conflicto` y Ana bloqueada.
- Correr contra Supabase (`DATABASE_URL` del Transaction pooler) y ver las tablas en su panel.
