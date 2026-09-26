# Convenciones del backend — Pasaje

> Complementa a `CONTRATO.md`. El contrato define **qué** expone la API; este documento define **cómo** se escribe el backend.
> Si algo de aquí choca con el contrato, gana el contrato.

Este repo es **solo el backend y la lógica compartida** (`shared/`). La app y el panel viven en otros repos.

---

## 1. Stack

| Pieza | Elección |
|---|---|
| Runtime | Node.js ≥ 20, **ESM** (`"type": "module"`) |
| Lenguaje | JavaScript + JSDoc en funciones exportadas |
| HTTP | Express 5 |
| Tiempo real | Socket.IO 4 (en el mismo proceso que Express) |
| Base de datos | PostgreSQL: **Supabase** (gratis) para compartir, Docker local para desarrollar |
| Acceso a BD | `pg` con SQL a mano, sin ORM |
| Migraciones | `node-pg-migrate` |
| Validación | `zod` |
| Auth | JWT propio (`jsonwebtoken`, HS256) + `bcryptjs` |
| Firma de boletos | `tweetnacl` (Ed25519) |
| Logs | `pino` + `pino-http` |
| Tareas programadas | `node-cron` |
| Pruebas | `node:test` + `supertest` |
| Formato | Prettier + ESLint |

**Supabase se usa solo como PostgreSQL.** No usamos Supabase Auth ni Realtime: el auth es JWT propio (teléfono + clave) y el tiempo real es Socket.IO, como fija el contrato.

---

## 2. Idioma

**Todo en español:** archivos, carpetas, variables, funciones, tablas, columnas, comentarios y commits. Se escribe sin tildes ni ñ en los identificadores (`anio`, `tarifaMaxima`, `vencerBoletos`), y con tildes en comentarios y mensajes.

Los nombres del contrato se usan tal cual: si el contrato dice `saldoDisponible`, el código dice `saldoDisponible` y la columna es `saldo_disponible`.

---

## 3. Estructura

```
shared/                   ← JS puro; la app lo copia tal cual (ver §9)
  boleto.js               ← codificar / decodificar / firmar / verificar
  tarifa.js               ← calcular monto de un cobro
  codigos.js              ← códigos de error, categorías, constantes de protocolo
  dev-keys.json           ← SOLO desarrollo
src/
  app.js                  ← arma Express (sin listen), exportable para pruebas
  servidor.js             ← http + Socket.IO + listen + trabajos
  config/index.js         ← único lugar que toca process.env
  bd/
    pool.js               ← pool de pg + conTransaccion()
    migraciones/
    semilla.js            ← datos semilla del §13 del contrato
  middlewares/            ← autenticar, exigirRol, validar, manejadorErrores
  modulos/
    <modulo>/
      rutas.js            ← solo rutas y middlewares
      controlador.js      ← lee req, llama al servicio, responde
      servicio.js         ← lógica de negocio
      repositorio.js      ← SQL
      esquemas.js         ← zod de body / query
      serializadores.js   ← fila de BD → JSON del contrato
  tiempoReal/             ← socket.js, eventos.js, emisor.js
  trabajos/               ← vencerBoletos.js
  utils/                  ← ErrorApp, logger, helpers
scripts/                  ← boletoPrueba.js (npm run boleto-prueba)
pruebas/
mocks/                    ← ejemplos JSON con la forma exacta de la API, para el front
```

Módulos: `auth`, `billetera`, `recargas`, `boletos`, `lineas`, `tabuladores`, `recolector`, `sincronizacion`, `ubicaciones`, `central`, `publico`, `mapa`.

**Dirección de dependencias:** `rutas → controlador → servicio → repositorio`. Un servicio puede llamar a otro servicio; un repositorio nunca llama a un servicio. El controlador no escribe SQL; el repositorio no conoce `req`/`res`.

---

## 4. Código

- Funciones pequeñas (idealmente < 30 líneas), una responsabilidad, **retornos tempranos**.
- Nada de strings mágicos: códigos de error, roles, categorías, eventos y límites (`MAX_BOLETOS_ACTIVOS = 5`, `DIAS_VIGENCIA_BOLETO = 7`, `VENTANA_ANULAR_MS = 120_000`…) van en constantes.
- JSDoc en toda función exportada (qué hace, parámetros, qué lanza).
- Prettier: comillas simples, punto y coma, 100 columnas, comas finales.

---

## 5. API

- Base: `/api/v1`. JSON `camelCase`, fechas ISO 8601 UTC, IDs UUID v4 (`crypto.randomUUID()`).
- Las respuestas tienen **exactamente** la forma del contrato: ni campos de más ni de menos. Siempre pasan por un serializador.
- Códigos HTTP del contrato: `201` al crear, `204` sin cuerpo, etc.
- **Errores:** se lanza `new ErrorApp(codigo, mensaje, { estado, detalle })`. El `manejadorErrores` es el único que arma `{ error: { codigo, mensaje, detalle? } }`.
  - `mensaje` apto para mostrarse al usuario.
  - Un error no controlado → `500 ERROR_INTERNO`: se loguea completo y **no** se filtra el stack al cliente.
- Express 5 reenvía al `manejadorErrores` los errores de los handlers `async`. `try/catch` solo cuando se agrega contexto o se traduce un error (por ejemplo, una violación de `UNIQUE`). **Nunca** tragarse un error.
- **Validación:** todo body/query pasa por `validar(esquema)` → `400 VALIDACION` con los detalles de zod en `detalle`.

---

## 6. Dinero

- **Siempre enteros en céntimos.** Nunca `float`. En BD: `BIGINT`.
- El único redondeo del sistema está en `shared/tarifa.js` (`Math.round`).
- **Todo cambio de saldo** ocurre dentro de `conTransaccion()` y:
  1. bloquea la billetera (`SELECT … FOR UPDATE`),
  2. actualiza `saldo_disponible` / `saldo_reservado`,
  3. inserta el movimiento con `saldo_disponible_despues`.
- `movimientos` es **solo inserción**: nunca se edita ni se borra.
- Invariantes que las pruebas deben cuidar: `saldo_disponible ≥ 0`, `saldo_reservado ≥ 0`, `saldo_reservado = Σ monto_reservado de los boletos activos`.

---

## 7. Base de datos

- Tablas y columnas en `snake_case`, plural (`usuarios`, `boletos`, `cobros`).
- PK `id UUID`. Fechas `TIMESTAMPTZ`. Enums como `TEXT` + `CHECK`.
- Códigos cortos: `INTEGER CHECK (codigo BETWEEN 1 AND 65535)`. `SMALLINT` no alcanza (máx. 32767).
- Unicidad del negocio, en la BD:
  - `cobros.bid` UNIQUE (parcial, sin anulados) → idempotencia de `/sync/cobros` y detección de doble gasto.
  - `tramos (linea_id, codigo)`, `lineas.codigo`, `unidades.codigo`, `usuarios.telefono`.
- Consultas siempre parametrizadas (`$1, $2…`). Nada de concatenar SQL.
- Cambios de esquema **solo** con una migración nueva; nunca se edita una migración ya en `main`.

### Supabase

- Conexión por el **Transaction pooler** (puerto **6543**, IPv4) con `PGSSL=true`. La conexión directa es solo IPv6, y el Session pooler (5432) no pasa desde nuestra red.
- Supabase corre **PostgreSQL 17**; el Docker local usa la misma versión.
- En modo transacción cada consulta suelta puede caer en una conexión distinta del servidor. Por eso:
  - todo lo que necesite la misma conexión va dentro de `conTransaccion()` (`BEGIN … COMMIT` sí queda en una sola conexión);
  - nada de estado de sesión: ni `SET` sin `LOCAL`, ni `LISTEN/NOTIFY`, ni advisory locks de sesión, ni sentencias preparadas con nombre (`pg` solo las usa si se le pasa `name`, así que **no se pasa**);
  - las migraciones corren con `--no-lock` (el lock de node-pg-migrate es de sesión).
- Las migraciones se corren desde aquí (`npm run bd:migrar`), no desde el editor SQL de Supabase.

---

## 8. Tiempo y zona horaria

- Se guarda y se responde en UTC.
- **"Domingo" y "feriado" se evalúan en hora de Venezuela (`America/Caracas`, UTC−4).** Un cobro del domingo a las 21:00 en Mérida es lunes 01:00 UTC y lleva recargo. Esta lógica vive en `shared/tarifa.js`.
- El tabulador que aplica a un cobro es el vigente en `ocurridoEn`, no el de la hora de sincronización.
- Tolerancia de reloj al validar vencimiento: 10 min.

---

## 9. `shared/`

- Lo usan este backend y la app React Native, así que es **JS puro**:
  - nada de `Buffer`, `crypto` de Node, `fs` ni `process`;
  - bytes con `Uint8Array` / `DataView`; base64url propio;
  - única dependencia: `tweetnacl`.
- Funciones puras y deterministas: la hora y los feriados entran como parámetros.
- Cada archivo tiene pruebas con **vectores fijos** (boleto conocido → bytes exactos; tramo/categoría/fecha → monto exacto), para que la app pueda correr los mismos casos.
- La app copia la carpeta tal cual. **Tocar `shared/` = avisar en el grupo antes** (contrato §16).

---

## 10. Seguridad

- Secretos solo en variables de entorno, validadas al arrancar en `config/index.js`. `.env` nunca se commitea; `.env.example` sí.
- `shared/dev-keys.json` es solo para desarrollo. Fuera de `development`/`test`, la llave de firma viene de `LLAVE_FIRMA_BOLETOS` y el arranque falla si falta.
- Nunca loguear claves, JWT, la llave privada ni el `raw` completo de un boleto (solo el `bid`).
- Claves con `bcryptjs` (costo 10). JWT con expiración.
- `exigirRol(...)` en cada router según el rol del contrato; cuenta `bloqueado` → `403 CUENTA_BLOQUEADA`.

### Variables de entorno

| Variable | Ejemplo |
|---|---|
| `NODE_ENV` | `development` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgres://pasaje:pasaje@localhost:5433/pasaje` |
| `DATABASE_URL_PRUEBAS` | `postgres://pasaje:pasaje@localhost:5433/pasaje_pruebas` |
| `PGSSL` | `false` local · `true` Supabase (Transaction pooler, puerto 6543) |
| `JWT_SECRETO` | cadena aleatoria larga |
| `JWT_EXPIRA` | `7d` |
| `LLAVE_FIRMA_BOLETOS` | llave secreta Ed25519 en base64url (no requerida en dev) |

---

## 11. Tiempo real

- Nombres de eventos y salas en constantes (`tiempoReal/eventos.js`).
- El socket se autentica con el mismo JWT (`auth.token`); al conectar se une a `usuario:<id>`, `rol:<rol>` y, si es central, a `central`.
- Los servicios emiten por `tiempoReal/emisor.js`, nunca importando `io` directamente, para poder probarlos sin socket.

---

## 12. Pruebas

- `npm test` corre contra la BD de pruebas (`DATABASE_URL_PRUEBAS`), con migraciones y limpieza entre suites.
- Pruebas obligatorias:
  - `shared/tarifa.js` y `shared/boleto.js` (vectores fijos);
  - dinero: recarga, emisión, cobro, liberación, vencimiento;
  - `/sync/cobros`: idempotencia, `duplicado`, `conflicto` + bloqueo, `rechazado` por cada `BOLETO_*`;
  - `DELETE /sync/cobros/:bid` dentro y fuera de la ventana de 2 min.
- Las pruebas de endpoints comparan contra la forma del contrato.

---

## 13. Git

- `main` siempre arranca. Ramas `feat/…`, `fix/…`, `chore/…`.
- Commits en español, estilo Conventional Commits (`feat(boletos): emitir boletos firmados`).
- PRs pequeños, uno por paso del plan.
- Un cambio al contrato va en su propio commit, **después** de avisar en el grupo.
