# API Pasaje — referencia rápida (fase 1)

Base: `http://<ip-del-backend>:<puerto>/api/v1`. Montos en **céntimos**. Fechas ISO 8601 UTC.
Auth: `Authorization: Bearer <token>` (sale de login o registro).
Ejemplos reales de cada respuesta: carpeta [`mocks/`](../mocks) (se regeneran con `npm run mocks`).

Errores, siempre: `{ "error": { "codigo", "mensaje", "detalle?" } }`. `mensaje` se puede mostrar tal cual. Ver [`mocks/errores-ejemplo.json`](../mocks/errores-ejemplo.json).

## Sin token

| Método | Ruta | Respuesta | Mock |
|---|---|---|---|
| GET | `/` | `{ api, version, salud }` | — |
| GET | `/salud` | `{ ok, bd }` (503 si la BD no responde) | — |
| POST | `/auth/registro` | `201 { token, usuario }` · solo pasajeros | `auth-registro` |
| POST | `/auth/login` | `{ token, usuario }` | `auth-login` |
| GET | `/publico/tarifas` | `{ tabulador, proximo }` | `publico-tarifas` |

## Cualquier usuario con sesión

| Método | Ruta | Respuesta | Mock |
|---|---|---|---|
| GET | `/me` | `Usuario` (funciona aunque esté bloqueado) | `me-recolector` |
| GET | `/lineas` | `Linea[]` con `tarifaCompleta` por tramo | `lineas` |
| GET | `/mapa/unidades` | unidades con ubicación de los últimos 5 min | `mapa-unidades` |

## Pasajero

| Método | Ruta | Body | Respuesta | Mock |
|---|---|---|---|---|
| GET | `/billetera` | — | `Billetera` | `billetera` |
| POST | `/recargas` | `{ monto, metodo: "simulada" }` | `201 { recarga, billetera }` | `recargas-post` |
| GET | `/movimientos?limite=20` | — | `Movimiento[]` (máx. 100) | `movimientos` |
| POST | `/boletos` | `{ cantidad? }` (1–5, por defecto 5) | `201 { boletos: BoletoEmitido[], billetera }` | `boletos-post` |
| GET | `/boletos` | — | `BoletoEmitido[]` activos | `boletos-get` |
| POST | `/boletos/revocar` | — | `{ revocados, billetera }` | — |
| POST | `/sync/recibos` | `{ recibos: ReciboLocal[] }` (1–500) | `{ resultados }`, igual que `/sync/cobros` | `sync-recibos` |
| GET | `/me/frecuentes` | — | `{ lineaCodigo, tramoCodigo, veces }[]` | `me-frecuentes` |

- `POST /boletos` completa hasta 5 activos según alcance el saldo. Si ya tiene 5, responde `boletos: []`. Si no alcanza ni para uno: `422 SALDO_INSUFICIENTE`.
- `viajesEstimados` es `null` para exonerados (viajes ilimitados).
- `/sync/recibos` (fase 2): el pasajero sube los recibos del paso 3 NFC. Si su recibo llega antes que el cobro del recolector, el cobro se crea con el recibo; el que llega segundo solo lo confirma (`confirmadoPor` pasa a tener los dos).

## Recolector

| Método | Ruta | Body | Respuesta | Mock |
|---|---|---|---|---|
| GET | `/recolector/paquete` | — | todo para cobrar sin conexión | `recolector-paquete` |
| POST | `/sync/cobros` | `{ cobros: CobroLocal[] }` (1–500) | `{ resultados }` | `sync-cobros-*` |
| DELETE | `/sync/cobros/:bid` | — | `204` · `404` si no es suyo · `409` si pasaron 2 min | — |
| GET | `/recolector/cobros?desde=` | — | `{ total, cantidad, cobros }` (por defecto, desde hoy 00:00 VE) | `recolector-cobros` |
| POST | `/ubicaciones` | `{ lat, lng }` | `204` | — |

Cada resultado de `/sync/cobros`:

| `estado` | Cuándo | Trae |
|---|---|---|
| `ok` | cobrado | `cobro` |
| `ok` | el otro teléfono ya lo había reportado: se confirma, sin cobrar dos veces | `cobro` |
| `duplicado` | el mismo teléfono reenvió el mismo viaje (misma unidad, mismo segundo) | `cobro` |
| `conflicto` | el boleto ya se usó en otra unidad u otro momento: **cuenta del pasajero bloqueada** | `codigo: BOLETO_USADO`, `cobro` original |
| `rechazado` | falló una regla del §8.3 | `codigo`: `BOLETO_INVALIDO`, `BOLETO_VENCIDO`, `BOLETO_USADO`, `BOLETO_INSUFICIENTE`, `TRAMO_INVALIDO` |

El backend recalcula el monto con el tabulador vigente en `ocurridoEn`; el `monto` del recolector solo queda como referencia.

## Central

| Método | Ruta | Body | Mock |
|---|---|---|---|
| GET | `/central/resumen?desde=` | — | `central-resumen` |
| GET · POST | `/central/tabuladores` | `Tabulador` sin `id` | `central-tabuladores` |
| GET · POST | `/central/lineas` | `{ codigo, nombre, tipo, tramos: [{ codigo, nombre, km, tarifaManual? }] }` | `lineas` |
| PUT | `/central/lineas/:id` | `{ nombre?, tipo?, tramos? }` (crea o actualiza por código; `tarifaManual: null` la quita) | — |
| GET | `/central/categorias/pendientes` | — | `central-categorias-pendientes` |
| PUT | `/central/usuarios/:id/categoria` | `{ verificada }` (false = queda general) | — |
| GET | `/central/conflictos?todos=true` | — (por defecto solo abiertos) | `central-conflictos` |
| PUT | `/central/usuarios/:id/bloqueo` | `{ bloqueado }` (desbloquear resuelve sus conflictos) | — |
| GET · POST | `/central/unidades` | `{ codigo, placa, lineaCodigo, recolectorId? \| recolector?: { nombre, telefono, clave } }` | `central-unidades` |
| PUT | `/central/unidades/:id` | `{ lineaCodigo?, recolectorId? (null = quitar) \| recolector? }` | — |
| GET | `/central/recolectores` | — | `central-recolectores` |

Los recolectores se crean al asignarlos a una unidad (`recolector: {…}` en POST/PUT de unidades).

## Tiempo real (Socket.IO)

```js
import { io } from 'socket.io-client';
const socket = io('http://<ip>:<puerto>', { auth: { token } });
```

| Evento | Payload | Lo recibe |
|---|---|---|
| `cobro:confirmado` | `{ cobro, billetera }` | el pasajero cobrado |
| `unidad:ubicacion` | `{ unidadCodigo, lat, lng }` | todos |
| `tarifa:aviso` | `Aviso` | pasajeros (nuevo tabulador) |
| `paquete:actualizado` | `{}` | recolectores: vuelvan a pedir `/recolector/paquete` |

Token inválido → `connect_error` con `message: "NO_AUTENTICADO"`.

## Usuarios de prueba (clave `1234`)

| Teléfono | Quién |
|---|---|
| 04140000001 | Ana, pasajera estudiante |
| 04140000004 | Pedro, pasajero general |
| 04140000005 | Rosa, pasajera exonerada |
| 04140000002 | Luis, recolector, unidad 101 (línea 1, urbana) |
| 04140000006 | Marta, recolectora, unidad 102 (línea 3, suburbana) |
| 04140000003 | Central Mérida |
