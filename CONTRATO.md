# Pasaje — Contrato del MVP (v2)

> Fuente única de verdad para los tres. Si algo cambia aquí, se avisa en el grupo **antes** de tocar código.
> Ciudad piloto: Mérida, Venezuela.
> **v2:** boletos firmados, rutas frecuentes, una sola app con dos modos, plan en dos fases.

---

## 1. Resumen

El pasajero recarga saldo (**1 crédito = 1 Bs**). Con ese saldo la app obtiene varios **boletos firmados** por el servidor. Al subir a la unidad, acerca su teléfono al del recolector (NFC, o QR en fase 2). El teléfono del pasajero sugiere su **tramo frecuente** en esa línea; el recolector ve el tramo ya marcado y la **categoría** del pasajero (general, 🎓 estudiante, 👴 exonerado), y confirma. Los dos teléfonos se quedan con una copia del viaje y la suben al backend, que cobra la tarifa del tabulador de la gaceta.

**Roles:**

| Rol | Dónde | Qué hace |
|---|---|---|
| `pasajero` | App móvil, modo pasajero | Recarga, tiene boletos, paga por NFC/QR, ve historial y mapa |
| `recolector` | App móvil, modo recolector | Cobra por NFC/QR con su tramo frecuente sugerido, ve categoría, envía ubicación |
| `central` | Panel web | Mapa, resumen, tabulador de la gaceta, líneas, verificación de categorías, unidades |

---

## 2. Fases

| | Fase 1 (esta noche) | Fase 2 |
|---|---|---|
| Boleto | Firmado (formato definitivo) | Igual |
| Conexión | El **recolector** necesita internet: sube cada cobro al instante | Nadie necesita internet: cola local + sincronización en segundo plano |
| Pasajero sin datos | ✅ Ya funciona: sus boletos viven en el teléfono | ✅ |
| Métodos | NFC | NFC + QR |
| Rutas frecuentes | ✅ | ✅ |
| Categoría visible | ✅ | ✅ |
| Recibo en el teléfono del pasajero | ✅ por NFC | ✅ + sincroniza recibos |

La regla: **nada de la fase 1 se tira en la fase 2.** El cobro "online" de la fase 1 es simplemente una sincronización de un solo cobro.

---

## 3. Stack y reparto

| Parte | Tecnología | Responsable |
|---|---|---|
| App móvil (una sola, dos modos): núcleo NFC/HCE, boletos, almacenamiento local, QR y sincronización | React Native, Expo **dev build** (no Expo Go) | **Andy** |
| Pantallas "normales" de la app (registro, inicio, recargas, historial, mi línea, cobros de hoy, mapa) | React Native | **Jose** |
| Panel web de la central | React + Vite | **Jose** |
| Backend, firma de boletos, tarifas, reconciliación | Node.js + Express + Socket.IO + PostgreSQL | **Juan** |

Juan también apoya a Andy con lo nativo cuando se tranque.

**Librerías acordadas**

- NFC lector (modo recolector): `react-native-nfc-manager`
- HCE (modo pasajero): `react-native-hce`
- Firma Ed25519 (backend y app): `tweetnacl` (JS puro, corre en Node y en RN)
- Boletos guardados: `expo-secure-store`
- Cola local de cobros y recibos: `expo-sqlite`
- Fase 2: `expo-background-task` (sincronización), `expo-camera` (escanear QR), `react-native-qrcode-svg` (mostrar QR)
- Mapa: `react-native-maps` (móvil), Leaflet (web)

**Solo Android** para NFC. iPhone y Android sin NFC pagan por QR en fase 2.

---

## 4. Convenciones

- Base URL: `http://<ip-local>:3000/api/v1`
- JSON, `camelCase`, fechas ISO 8601 UTC, IDs UUID v4 en string.
- **Dinero siempre en céntimos, entero.** `20000` = 200,00 Bs.
- Auth: `Authorization: Bearer <jwt>` en todo excepto `/auth/*` y `/publico/*`.
- Error: siempre `{ "error": { "codigo", "mensaje", "detalle?" } }`. `mensaje` se muestra tal cual al usuario.
- **Códigos cortos:** además del UUID, cada línea, tramo y unidad tiene un `codigo` numérico de 2 bytes (1–65535). Es lo que viaja por NFC.

---

## 5. Modelos

```ts
type Rol = "pasajero" | "recolector" | "central";
type Categoria = "general" | "estudiante" | "exonerado";

interface Usuario {
  id: string;
  nombre: string;
  telefono: string;
  rol: Rol;
  categoria: Categoria;          // solo pasajeros; "general" por defecto
  categoriaVerificada: boolean;  // sin verificar ⇒ se cobra como general
  bloqueado: boolean;            // por doble gasto detectado
  creadoEn: string;
}

interface Billetera {
  saldoDisponible: number;       // céntimos, se puede usar para nuevos boletos
  saldoReservado: number;        // céntimos, comprometido en boletos sin usar
  boletosActivos: number;
  tarifaReferencia: number;      // urbano mínimo con el descuento de su categoría
  viajesEstimados: number;       // floor((disponible + reservado) / tarifaReferencia)
  avisos: Aviso[];
}

interface Aviso {
  id: string;
  tipo: "CAMBIO_TARIFA" | "CATEGORIA_APROBADA" | "CATEGORIA_RECHAZADA" | "CUENTA_BLOQUEADA";
  mensaje: string;
  vigenteDesde?: string;
}

interface Recarga {
  id: string;
  monto: number;
  metodo: "simulada" | "pago_movil";   // pasarela del banco más adelante
  estado: "pendiente" | "confirmada" | "rechazada";
  creadoEn: string;
}

interface Movimiento {
  id: string;
  tipo: "recarga" | "reserva" | "cobro" | "liberacion";
  monto: number;                 // + entra al disponible, − sale del disponible
  saldoDisponibleDespues: number;
  cobroId?: string;
  creadoEn: string;
}

// ---- Tarifas (sección 7) ----
interface Tabulador {
  id: string;
  fuente: string;                // "Gaceta Oficial N° 43.xxx" / "Acuerdo Concejo Municipal"
  vigenteDesde: string;
  descuentos: { general: number; estudiante: number; exonerado: number }; // 0, 0.5, 1
  recargoDomingoFeriado: number; // 0.2 = +20 %; 0 si no aplica
  urbanoMinimo: number;          // céntimos, pasaje completo
  suburbano: { hastaKm: number; monto: number }[];
}

interface Linea {
  id: string;
  codigo: number;                // uint16
  nombre: string;                // "Chorros de Milla"
  tipo: "urbana" | "suburbana";
  tramos: Tramo[];
}

interface Tramo {
  id: string;
  codigo: number;                // uint16, único dentro de la línea
  nombre: string;                // "Centro – Chorros de Milla"
  km: number;
  tarifaCompleta: number;        // calculada por el backend
  tarifaManual?: number;         // solo la central; gana sobre el cálculo
  frecuencia: number;            // cobros de los últimos 30 días, para ordenar botones
}

interface Unidad {
  id: string;
  codigo: number;                // uint16
  placa: string;
  lineaId: string;
  recolectorId: string | null;
}

// ---- Boletos y cobros (sección 8) ----
interface BoletoEmitido {
  bid: string;                   // UUID
  raw: string;                   // base64url de los 106 bytes firmados (sección 8.1)
  montoReservado: number;
  expiraEn: string;
}

interface Cobro {
  id: string;
  bid: string;
  pasajeroNombre: string;
  categoriaAplicada: Categoria;
  lineaCodigo: number;
  tramoCodigo: number;
  tramoNombre: string;
  unidadCodigo: number;
  monto: number;
  metodo: "nfc" | "qr";
  ocurridoEn: string;            // reloj del recolector al cobrar
  sincronizadoEn: string;
  confirmadoPor: ("recolector" | "pasajero")[];
  estado: "ok" | "conflicto";
}
```

---

## 6. Endpoints

### 6.1 Auth
- `POST /auth/registro` `{ nombre, telefono, clave, rol, categoria? }` → `201 { token, usuario }`
- `POST /auth/login` `{ telefono, clave }` → `200 { token, usuario }`
- `GET /me` → `Usuario`

### 6.2 Pasajero
- `GET /billetera` → `Billetera`
- `POST /recargas` `{ monto, metodo }` → `201 { recarga, billetera }` (fase 1: `simulada`, se confirma al instante)
- `GET /movimientos?limite=20`
- `POST /boletos` `{ cantidad }` → `201 { boletos: BoletoEmitido[], billetera }`
  Emite hasta completar **5 boletos activos**, según alcance el saldo disponible. Cada boleto reserva `montoReservado` (sección 8.2).
- `GET /boletos` → los activos del pasajero (para reconciliar lo que tiene guardado).
- `POST /boletos/revocar` → invalida todos sus boletos activos y libera la reserva (teléfono perdido).
- `GET /me/frecuentes` → `{ lineaCodigo, tramoCodigo, veces }[]` (respaldo de las frecuentes si reinstala la app)
- `GET /lineas` → `Linea[]` (para que vea cuánto cuesta cada tramo)

### 6.3 Recolector
- `GET /recolector/paquete` → todo lo que necesita para cobrar **sin preguntarle al backend en cada toque**:
  ```json
  {
    "llavePublica": "base64url Ed25519",
    "unidad": Unidad,
    "linea": Linea,                 // tramos ordenados por frecuencia
    "tabulador": Tabulador,         // vigente
    "tabuladorProximo": Tabulador | null,
    "feriados": ["2026-10-12"],
    "revocados": ["bid", "..."],    // boletos revocados o de cuentas bloqueadas
    "generadoEn": "..."
  }
  ```
  La app lo guarda y lo refresca cada vez que tiene conexión (fase 1: al abrir la pantalla Cobrar).
- `POST /sync/cobros` `{ cobros: CobroLocal[] }` → `200 { resultados: { bid, estado: "ok" | "duplicado" | "conflicto" | "rechazado", codigo?, cobro? }[] }`
  Fase 1: se llama con **un** cobro justo después del toque. Fase 2: con la cola completa. Idempotente por `bid`.
  ```ts
  interface CobroLocal {
    raw: string;            // el boleto tal cual lo leyó
    tramoCodigo: number;
    monto: number;          // lo que calculó el recolector
    metodo: "nfc" | "qr";
    ocurridoEn: string;
  }
  ```
- `DELETE /sync/cobros/:bid` → anula un cobro propio de hace menos de 2 min (botón "Corregir"); libera la reserva del boleto para volver a cobrarlo con otro tramo.
- `GET /recolector/cobros?desde=` → `{ total, cantidad, cobros: Cobro[] }`
- `POST /ubicaciones` `{ lat, lng }` → `204` (cada 30 s en turno)

### 6.4 Sincronización del pasajero (fase 2)
- `POST /sync/recibos` `{ recibos: ReciboLocal[] }` → mismo formato de resultados que `/sync/cobros`.
  Si el recibo llega antes que el cobro del recolector, **el cobro se crea con el recibo**. El que llegue segundo solo lo confirma (`confirmadoPor`).
  ```ts
  interface ReciboLocal {
    bid: string;          // del RECIBO (paso 3 NFC)
    lineaCodigo: number;  // del PEDIR_BOLETO (paso 2)
    unidadCodigo: number; // del PEDIR_BOLETO (paso 2)
    tramoCodigo: number;  // del RECIBO
    monto: number;        // del RECIBO, céntimos
    ocurridoEn: string;   // del RECIBO (uint32 segundos → ISO 8601 UTC)
  }
  ```
  Como el recibo trae `ocurridoEn` en segundos, el backend compara cobro y recibo **truncando a segundos**. Solo existe por NFC (el QR no tiene paso 3).

### 6.5 Central
- `GET /central/resumen?desde=`
- `POST /central/tabuladores` · `GET /central/tabuladores`
- `GET/POST/PUT /central/lineas` (con tramos y `tarifaManual`)
- `GET /central/categorias/pendientes` · `PUT /central/usuarios/:id/categoria` `{ verificada }`
- `GET /central/conflictos` · `PUT /central/usuarios/:id/bloqueo` `{ bloqueado }`
- `GET/POST /central/unidades`

### 6.6 Público y compartido
- `GET /publico/tarifas` → `{ tabulador, proximo }`
- `GET /mapa/unidades` → `{ unidadCodigo, placa, lineaNombre, lat, lng, actualizadoEn }[]` (últimos 5 min)

---

## 7. Líneas y tarifas por gaceta

1. El **Ministerio de Transporte** publica en Gaceta Oficial el pasaje urbano mínimo nacional y una escala suburbana por km. En 2026 se indexa a 0,25 USD tasa BCV y se ajusta cada mes (septiembre 2026: urbano 200 Bs; suburbano de 280 a 990 Bs).
2. El **Concejo Municipal** y el sindicato bajan eso a un tabulador por ruta según la distancia.
3. **Descuentos por ley:** estudiante 50 %; adultos mayores y personas con discapacidad exonerados. Algunas gacetas suman recargo en domingos y feriados.

El sistema guarda **distancias, no precios**:

```
tarifaCompleta = tramo.tarifaManual
              ?? (linea.tipo == "urbana" ? tab.urbanoMinimo : rango de tab.suburbano para tramo.km)
recargo        = esDomingoOFeriado(ocurridoEn) ? tab.recargoDomingoFeriado : 0
monto          = redondear(tarifaCompleta × (1 + recargo) × (1 − tab.descuentos[categoria]))
```

Esta función vive en `/shared/tarifa.js` y la usan **igual** el backend y la app del recolector (que la calcula offline con el paquete). El backend recalcula al sincronizar: si su resultado no coincide con el `monto` del recolector (por ejemplo, un tabulador que cambió), **gana el tabulador vigente en `ocurridoEn`**.

---

## 8. Boletos firmados

### 8.1 Formato (106 bytes)

| Bytes | Campo | Notas |
|---|---|---|
| 1 | `version` | `0x01` |
| 16 | `bid` | UUID del boleto |
| 16 | `uid` | UUID del pasajero |
| 1 | `categoria` | `0` general · `1` estudiante · `2` exonerado (ya verificada; sin verificar ⇒ `0`) |
| 4 | `montoReservado` | uint32 big-endian, céntimos |
| 4 | `expira` | uint32, segundos Unix |
| 64 | `firma` | Ed25519 del servidor sobre los 42 bytes anteriores |

- En la API y en el QR viaja como **base64url** (~142 caracteres).
- La app del recolector verifica la firma con la `llavePublica` del paquete: **si la firma es válida, el boleto es real**, sin preguntarle a nadie.
- Vigencia: **7 días**. Un boleto vencido sin usar libera su reserva automáticamente (job diario del backend).

### 8.2 Cuánto reserva cada boleto

`montoReservado` = la tarifa **más cara de toda la red** para la categoría del pasajero, con recargo incluido. Así cualquier tramo cabe en un boleto. Al cobrar se usa la tarifa real y **la diferencia vuelve al saldo disponible** (`Movimiento` tipo `liberacion`).

### 8.3 Reglas del recolector al leer un boleto

En orden; el primero que falle muestra el error:

1. Firma válida → si no, `BOLETO_INVALIDO`
2. `expira` > ahora − 10 min de tolerancia de reloj → `BOLETO_VENCIDO`
3. `bid` no está en `revocados` ni en su propia lista de boletos ya cobrados → `BOLETO_USADO`
4. `monto` ≤ `montoReservado` → `BOLETO_INSUFICIENTE` (pasa si el tabulador subió después de emitirse: el pasajero debe conectarse para renovar boletos)

### 8.4 Doble gasto

Un teléfono rooteado podría copiar un boleto y usarlo en dos unidades antes de que alguna sincronice. Al sincronizar, el segundo `bid` repetido queda en `conflicto`, **la cuenta se bloquea** y aparece en `/central/conflictos`. La pérdida máxima por cuenta es 5 boletos. El primer cobro sincronizado es el que vale.

---

## 9. Protocolo NFC (v2)

**Modo pasajero = tarjeta emulada (HCE). Modo recolector = lector.** AID propietario `F0504153450002`.

El HCE **solo responde mientras la pantalla "Pagar" está abierta**, para que nadie cobre acercando un lector en la cola.

### Intercambio (un solo toque, ~300 ms)

| # | Recolector envía | Pasajero responde |
|---|---|---|
| 1 | `SELECT` `00 A4 04 00 07 F0 50 41 53 45 00 02 00` | `90 00` |
| 2 | `PEDIR_BOLETO` `80 10 00 00 04 [lineaCodigo:2][unidadCodigo:2]` | `[boleto:106][tramoSugerido:2] 90 00` · sin boletos: `6A 82` |
| 3 | `RECIBO` `80 20 00 00 1A [bid:16][tramoCodigo:2][monto:4][ocurrido:4]` | `90 00` (lo guarda en su historial y lo marca como usado) |

- `tramoSugerido`: el tramo más frecuente del pasajero **en esa línea**, según su historial local. `00 00` si no tiene.
- El paso 3 cierra el trato: **los dos teléfonos tienen el mismo registro**. Si el paso 3 falla (se separaron), el recolector cobra igual y el pasajero se entera al sincronizar.
- AID desconocido → `6D 00`. Comando desconocido → `6D 00`.

### ¿Qué tramo se cobra? (pantalla Cobrar)

- El recolector tiene arriba un selector: **"Automático"** (por defecto) o un tramo fijo.
- **Automático:** usa el `tramoSugerido` del pasajero; si no tiene, usa el tramo más frecuente de la línea.
- **Tramo fijo:** para cuando el recolector sabe que todos van al mismo sitio.
- Después del toque, el recolector ve 3 segundos: **nombre, 🎓/👴 categoría, tramo y monto**, con un botón **"Corregir"** que anula el cobro local y le deja elegir otro tramo antes de sincronizar (fase 1: anula en el backend con `DELETE /sync/cobros/:bid` dentro de 2 minutos).
- Si el recolector duda de la categoría (no le muestran carnet), puede tocar **"Cobrar como general"**.

### QR (fase 2)

El pasajero muestra `P2:` + base64url(boleto) + `.` + tramoSugerido. El recolector lo escanea y sigue las mismas reglas. Sin paso 3: el recibo le llega al pasajero al sincronizar.

---

## 10. Almacenamiento local (app)

| Qué | Dónde | Modo |
|---|---|---|
| Boletos sin usar | `expo-secure-store` | Pasajero |
| Historial de viajes / recibos y frecuentes por línea | SQLite `recibos` | Pasajero |
| Paquete del recolector | SQLite `paquete` | Recolector |
| Cobros pendientes de subir y `bid` ya cobrados | SQLite `cola_cobros` | Recolector |

- Pasajero: cuando tiene internet y le quedan **menos de 3 boletos**, pide más (`POST /boletos`).
- Fase 2: un job cada 15 min (cuando Android lo permita) sube `cola_cobros` / `recibos` y refresca paquete y boletos. También se dispara al recuperar conexión.

---

## 11. Tiempo real (Socket.IO)

`io(base, { auth: { token } })`. Salas: `usuario:<id>` y `central`.

| Evento | Payload | Quién |
|---|---|---|
| `cobro:confirmado` | `{ cobro, billetera }` | Pasajero (si tiene datos) |
| `unidad:ubicacion` | `{ unidadCodigo, lat, lng }` | Central y mapas abiertos |
| `tarifa:aviso` | `Aviso` | Pasajeros |
| `paquete:actualizado` | `{}` | Recolectores (vuelvan a pedir el paquete) |

---

## 12. Códigos de error

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `VALIDACION` | Body mal formado |
| 401 | `NO_AUTENTICADO` | JWT faltante o vencido |
| 403 | `ROL_INVALIDO` | Rol equivocado para ese endpoint |
| 403 | `CUENTA_BLOQUEADA` | Doble gasto detectado |
| 422 | `SALDO_INSUFICIENTE` | No alcanza para emitir boletos |
| 422 | `TRAMO_INVALIDO` | El tramo no es de la línea de la unidad |
| — | `BOLETO_INVALIDO` | Firma mala (app del recolector o sync) |
| — | `BOLETO_VENCIDO` | Pasaron los 7 días |
| — | `BOLETO_USADO` | `bid` ya cobrado o revocado |
| — | `BOLETO_INSUFICIENTE` | La tarifa real supera lo reservado |
| 500 | `ERROR_INTERNO` | Lo demás |

Los `BOLETO_*` los detecta primero la app del recolector sin internet; el backend los repite en `/sync/cobros` como `estado: "rechazado"`.

---

## 13. Datos semilla

```json
{
  "usuarios": [
    { "telefono": "04140000001", "clave": "1234", "nombre": "Ana Pasajera", "rol": "pasajero", "categoria": "estudiante", "categoriaVerificada": true },
    { "telefono": "04140000004", "clave": "1234", "nombre": "Pedro General", "rol": "pasajero", "categoria": "general", "categoriaVerificada": true },
    { "telefono": "04140000005", "clave": "1234", "nombre": "Rosa Mayor", "rol": "pasajero", "categoria": "exonerado", "categoriaVerificada": true },
    { "telefono": "04140000002", "clave": "1234", "nombre": "Luis Recolector", "rol": "recolector" },
    { "telefono": "04140000003", "clave": "1234", "nombre": "Central Mérida", "rol": "central" },
    { "telefono": "04140000006", "clave": "1234", "nombre": "Marta Recolectora", "rol": "recolector" }
  ],
  "tabulador": {
    "fuente": "Tabulador septiembre 2026 (valores de prueba)",
    "vigenteDesde": "2026-09-01T04:00:00Z",
    "descuentos": { "general": 0, "estudiante": 0.5, "exonerado": 1 },
    "recargoDomingoFeriado": 0,
    "urbanoMinimo": 20000,
    "suburbano": [ { "hastaKm": 10, "monto": 28000 }, { "hastaKm": 9999, "monto": 99000 } ]
  },
  "lineas": [
    { "codigo": 1, "nombre": "Chorros de Milla", "tipo": "urbana",
      "tramos": [ { "codigo": 1, "nombre": "Centro – Chorros de Milla", "km": 5 },
                  { "codigo": 2, "nombre": "Centro – Milla", "km": 3 } ] },
    { "codigo": 2, "nombre": "San Benito", "tipo": "urbana",
      "tramos": [ { "codigo": 1, "nombre": "Centro – San Benito", "km": 4 } ] },
    { "codigo": 3, "nombre": "Mérida – Ejido", "tipo": "suburbana",
      "tramos": [ { "codigo": 1, "nombre": "Centro – Ejido", "km": 9 },
                  { "codigo": 2, "nombre": "Centro – La Parroquia", "km": 6 } ] }
  ],
  "unidades": [
    { "codigo": 101, "placa": "AB123CD", "linea": 1, "recolector": "04140000002" },
    { "codigo": 102, "placa": "AC456EF", "linea": 3, "recolector": "04140000006" }
  ],
  "boletoDePrueba": "se genera con `npm run boleto-prueba` en /backend (llave de desarrollo en /shared/dev-keys.json)"
}
```

---

## 14. Pantallas

**Modo pasajero:** Registro (categoría; si no es general queda "pendiente de verificación") · Login · Inicio (saldo, ≈ N viajes, **"🎫 5 boletos listos"**, avisos) · Recargar · Pagar (NFC; QR en fase 2) · Historial · Mapa

**Modo recolector:** Login · Cobrar (selector Automático/tramo fijo, lector, tarjeta de resultado con categoría y "Corregir") · Mi línea · Cobros de hoy · Mapa · Toggle "En turno" (ubicación)

**Panel web:** Mapa · Resumen · Tabulador · Líneas y tramos · Categorías pendientes · Conflictos · Unidades

---

## 15. Paleta (morada)

| Token | Hex | Uso |
|---|---|---|
| `primario` | `#6D28D9` | Botones, header |
| `primarioOscuro` | `#4C1D95` | Pressed, texto sobre claro |
| `primarioClaro` | `#EDE9FE` | Fondos de tarjeta |
| `acento` | `#A78BFA` | Detalles, iconos |
| `exito` | `#16A34A` | Cobro confirmado |
| `error` | `#DC2626` | Rechazos |
| `fondo` | `#FAFAFC` | Fondo general |
| `texto` | `#1F1B2E` | Texto principal |

---

## 16. Estructura del repo

```
/app            ← una sola app Expo (modo pasajero / recolector)
  /nucleo       ← Andy: nfc/, hce/, boletos/, almacen/, sync/
  /pantallas    ← Jose: pasajero/, recolector/, comunes/
/backend        ← Juan
/panel-central  ← Jose
/shared         ← boleto.js (encode/decode/verificar), tarifa.js, codigos.js, dev-keys.json
/mocks          ← JSON con la misma forma que la API
CONTRATO.md
```

`/shared` lo usan backend y app. **Si se toca, se avisa.**

---

## 17. Orden de trabajo — fase 1

1. **Todos (20 min):** leer esto y congelarlo.
2. **Juan:** `/shared` primero (boleto.js + tarifa.js + llaves de desarrollo + `npm run boleto-prueba`) → auth → billetera/recargas → líneas/tabulador → boletos → paquete → `/sync/cobros` → socket → ubicaciones → central.
3. **Andy:** setup de la app con dos modos → HCE pasajero con boleto de prueba → lector recolector → pantalla Cobrar → pantalla Pagar → almacén local.
4. **Jose:** pantallas pasajero y recolector contra `/mocks` → panel web → conectar a la API.
5. **Hito:** primer cobro real teléfono a teléfono con tramo sugerido y recibo en el pasajero.

**Fase 2:** jobs de sincronización, `/sync/recibos`, QR, conflictos en el panel.

---

## 18. Decisiones

- ✅ Tarifas por gaceta, línea y km; el recolector no pone precios.
- ✅ Recarga por pago móvil; simulada en el MVP; pasarela del banco más adelante.
- ✅ Pasajero sin datos: boletos firmados guardados en el teléfono.
- ✅ App para todos los pasajeros, con categorías verificadas por la central.
- ✅ Una sola app con dos modos; dos fases.
- ⏳ **"Contacto proximidad"**: se asumió NFC. Confirmar si se refería a otra cosa (Bluetooth, pago a número de teléfono).
