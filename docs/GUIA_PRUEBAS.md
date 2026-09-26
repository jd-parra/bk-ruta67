# Guía de pruebas — backend Pasaje (fase 1)

Tres niveles, de más rápido a más completo:

| Nivel | Qué prueba | Tiempo |
|---|---|---|
| [1. Automáticas](#1-pruebas-automáticas) | todas las pruebas del backend | 1 min |
| [2. Demo](#2-demo-de-punta-a-punta) | el flujo completo contra tu backend y Supabase | 1 min |
| [3. A mano](#3-prueba-a-mano-paso-a-paso) | cada endpoint con `curl`, viendo los números | 20 min |

Al final: [probar desde el teléfono](#4-desde-el-teléfono-o-la-laptop-de-otro) y [ver los datos en Supabase](#5-ver-los-datos-en-supabase).

---

## 1. Pruebas automáticas

Usan el Postgres local de Docker, **nunca** Supabase.

```bash
cd ~/Documents/JuanD/bk-ruta67
npm run bd:levantar      # solo la primera vez o si reiniciaste la laptop
npm test
```

✅ Esperado al final: `# fail 0`.

---

## 2. Demo de punta a punta

Con el backend corriendo (`npm run dev` en otra terminal):

```bash
npm run demo
```

✅ Esperado: todos los pasos con ✓ y `✅ Demo completa`. Simula las dos apps: Ana recarga y pide un boleto, el toque NFC usa el protocolo real del §9 (`shared/protocolo.js`), Luis valida el boleto **sin internet**, cobra, Ana recibe el cobro en vivo y sube su recibo, y Luis corrige el cobro.

---

## 3. Prueba a mano paso a paso

### 3.0 Preparar

**Terminal 1**: el backend.

```bash
npm run dev
```

**Terminal 2**: deja la base en el estado inicial. ⚠️ **Borra todos los datos de Supabase** y vuelve a cargar la semilla. Los números de esta guía asumen que partes de ahí.

```bash
npm run bd:reiniciar
```

En la misma terminal 2, define las variables y entra con todos los usuarios de prueba:

```bash
API=http://localhost:3001/api/v1      # cambia el puerto si tu .env dice otro
login() {
  curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
    -d "{\"telefono\":\"$1\",\"clave\":\"1234\"}" | jq -r .token
}
ANA=$(login 04140000001); PEDRO=$(login 04140000004); ROSA=$(login 04140000005)
LUIS=$(login 04140000002); MARTA=$(login 04140000006); CENTRAL=$(login 04140000003)
echo "Ana: ${ANA:0:20}…"
```

✅ Esperado: `Ana: eyJhbGciOiJIUzI1NiIs…`. Si sale `Ana: null`, el backend no está corriendo o el puerto es otro.

Atajos para escribir menos:

```bash
get()  { curl -s "$API$2" -H "Authorization: Bearer $1" | jq; }
post() { curl -s -X POST "$API$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "${3:-{\}}" | jq; }
```

### 3.1 Tiempo real (déjalo escuchando)

**Terminal 3**: escucha los eventos de Ana. Copia su token desde la terminal 2 con `echo $ANA`.

```bash
cd ~/Documents/JuanD/bk-ruta67
node -e "require('socket.io-client').io('http://localhost:3001',{auth:{token:process.argv[1]}}).onAny((e,d)=>console.log('📩',e,JSON.stringify(d)))" PEGA_AQUI_EL_TOKEN_DE_ANA
```

No imprime nada todavía. En el paso 3.5 verás llegar `📩 cobro:confirmado`.

### 3.2 Salud y tarifas

```bash
curl -s $API/salud | jq
curl -s $API/publico/tarifas | jq '.tabulador.urbanoMinimo, .proximo'
get $ANA /lineas | jq '.[] | {codigo, nombre, tramos: [.tramos[] | {codigo, km, tarifaCompleta}]}'
```

✅ Esperado:

- `{"ok": true, "bd": "ok"}`
- `20000` y `null`
- línea 1: tramos de 20.000 · línea 3 (suburbana, 9 y 6 km): 28.000

### 3.3 Billetera y recarga (Ana, estudiante)

```bash
get $ANA /billetera
post $ANA /recargas '{"monto":100000,"metodo":"simulada"}' | jq .billetera
```

✅ Esperado:

- **antes**: `saldoDisponible 0`, `tarifaReferencia 10000` (200 Bs con 50 %), `viajesEstimados 0`
- **después**: `saldoDisponible 100000`, `viajesEstimados 10`

❌ Prueba un error: `post $ANA /recargas '{"monto":1.5,"metodo":"simulada"}'` → `VALIDACION`.

### 3.4 Boletos

```bash
R=$(post $ANA /boletos '{"cantidad":5}')
echo "$R" | jq '{boletos: [.boletos[].montoReservado], billetera: .billetera | {saldoDisponible, saldoReservado, boletosActivos}}'
BOLETO=$(echo "$R" | jq -r '.boletos[0].raw'); BID=$(echo "$R" | jq -r '.boletos[0].bid')
BOLETO2=$(echo "$R" | jq -r '.boletos[1].raw')
```

✅ Esperado: 5 boletos de `14000` (la tarifa más cara de la red, 28.000, con 50 %). `saldoDisponible 30000`, `saldoReservado 70000`, `boletosActivos 5`.

- `post $ANA /boletos` otra vez → `"boletos": []` (ya tiene 5).
- `post $PEDRO /boletos` → `SALDO_INSUFICIENTE` (Pedro no tiene saldo).
- `post $ROSA /boletos | jq '.boletos[].montoReservado'` → cinco `0` (exonerada).

### 3.5 Cobro (Luis, unidad 101)

```bash
get $LUIS /recolector/paquete | jq '{unidad: .unidad.codigo, linea: .linea.nombre, tramos: [.linea.tramos[].codigo], revocados}'

OCURRIDO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
COBRO="{\"cobros\":[{\"raw\":\"$BOLETO\",\"tramoCodigo\":1,\"monto\":10000,\"metodo\":\"nfc\",\"ocurridoEn\":\"$OCURRIDO\"}]}"
post $LUIS /sync/cobros "$COBRO" | jq '.resultados[0] | {estado, monto: .cobro.monto, tramo: .cobro.tramoNombre}'
get $ANA /billetera | jq '{saldoDisponible, saldoReservado, boletosActivos}'
```

✅ Esperado:

- paquete: unidad `101`, `"Chorros de Milla"`, tramos `[1, 2]`, revocados `[]`
- cobro: `estado "ok"`, monto `10000`
- Ana: `saldoDisponible 34000` (le devolvieron los 4.000 que sobraban de la reserva), `saldoReservado 56000`, `boletosActivos 4`
- **terminal 3**: `📩 cobro:confirmado {...}`

### 3.6 Reenviar el mismo cobro (sin internet, reintento)

```bash
post $LUIS /sync/cobros "$COBRO" | jq '.resultados[0].estado'
get $ANA /billetera | jq .saldoDisponible
```

✅ Esperado: `"duplicado"` y el saldo **sigue en** `34000`: no se cobra dos veces.

### 3.7 Corregir el cobro (botón "Corregir", 2 minutos)

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $API/sync/cobros/$BID -H "Authorization: Bearer $LUIS"
get $ANA /billetera | jq '{saldoDisponible, saldoReservado, boletosActivos}'
```

✅ Esperado: `204`, y Ana vuelve a `30000` / `70000` / `5`.

Ahora cóbralo con el tramo correcto:

```bash
OCURRIDO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
post $LUIS /sync/cobros "{\"cobros\":[{\"raw\":\"$BOLETO\",\"tramoCodigo\":2,\"monto\":10000,\"metodo\":\"nfc\",\"ocurridoEn\":\"$OCURRIDO\"}]}" | jq '.resultados[0] | {estado, tramo: .cobro.tramoNombre}'
```

✅ Esperado: `"ok"`, `"Centro – Milla"`. Si esperas más de 2 minutos y vuelves a hacer el `DELETE` → `409`.

### 3.8 Rechazos

```bash
# Tramo que no es de la línea de Luis
post $LUIS /sync/cobros "{\"cobros\":[{\"raw\":\"$BOLETO2\",\"tramoCodigo\":9,\"monto\":0,\"metodo\":\"nfc\",\"ocurridoEn\":\"$(date -u +%FT%TZ)\"}]}" | jq '.resultados[0].codigo'

# Boleto de prueba: firma válida, pero este backend no lo emitió
PRUEBA=$(npm run -s boleto-prueba | jq -r .raw)
post $LUIS /sync/cobros "{\"cobros\":[{\"raw\":\"$PRUEBA\",\"tramoCodigo\":1,\"monto\":0,\"metodo\":\"nfc\",\"ocurridoEn\":\"$(date -u +%FT%TZ)\"}]}" | jq '.resultados[0].codigo'

# Pasajero intentando cobrar
post $ANA /sync/cobros '{"cobros":[]}' | jq '.error.codigo'
```

✅ Esperado: `"TRAMO_INVALIDO"`, `"BOLETO_INVALIDO"`, `"ROL_INVALIDO"`.

### 3.9 Línea suburbana (Marta, unidad 102)

```bash
post $PEDRO /recargas '{"monto":60000,"metodo":"simulada"}' > /dev/null
BP=$(post $PEDRO /boletos '{"cantidad":5}' | jq -r '.boletos[0].raw')
post $MARTA /sync/cobros "{\"cobros\":[{\"raw\":\"$BP\",\"tramoCodigo\":1,\"monto\":28000,\"metodo\":\"nfc\",\"ocurridoEn\":\"$(date -u +%FT%TZ)\"}]}" | jq '.resultados[0].cobro | {monto, lineaCodigo, tramoNombre}'
```

✅ Esperado: Pedro recibe **2** boletos (60.000 ÷ 28.000), y el cobro es `28000`, línea `3`, `"Centro – Ejido"`.

### 3.10 Doble gasto (alguien copió un boleto)

Marta intenta cobrar el **mismo** boleto que Luis ya le cobró a Ana:

```bash
post $MARTA /sync/cobros "{\"cobros\":[{\"raw\":\"$BOLETO\",\"tramoCodigo\":1,\"monto\":0,\"metodo\":\"nfc\",\"ocurridoEn\":\"$(date -u +%FT%TZ)\"}]}" | jq '.resultados[0] | {estado, codigo}'
get $ANA /billetera | jq .error.codigo
get $ANA /me | jq .bloqueado
get $CENTRAL /central/conflictos | jq '.[0] | {pasajero: .pasajero.nombre, original: .cobroOriginal.unidadCodigo, segundo: .segundoUso.unidadCodigo}'
get $LUIS /recolector/paquete | jq '.revocados | length'
```

✅ Esperado:

- `"conflicto"`, `"BOLETO_USADO"`
- Ana: `"CUENTA_BLOQUEADA"` en la billetera, `true` en `/me`
- conflicto: Ana, unidad original `101`, segundo uso `102`
- `4` boletos revocados en el paquete (los que le quedaban a Ana)

La central la desbloquea:

```bash
ANA_ID=$(get $ANA /me | jq -r .id)
curl -s -X PUT $API/central/usuarios/$ANA_ID/bloqueo -H "Authorization: Bearer $CENTRAL" -H 'Content-Type: application/json' -d '{"bloqueado":false}' | jq .bloqueado
get $ANA /billetera | jq '{saldoDisponible, saldoReservado}'
```

✅ Esperado: `false`, y Ana tiene `90000` disponible y `0` reservado: la reserva de los boletos revocados volvió a su saldo.

### 3.11 Ubicación y mapa

```bash
post $LUIS /ubicaciones '{"lat":8.5897,"lng":-71.1561}'
get $ANA /mapa/unidades
```

✅ Esperado: el primero no imprime nada (es un `204`). El mapa muestra la unidad `101`, placa `AB123CD`. A los 5 minutos sin actualizar, desaparece del mapa.

### 3.12 Central

```bash
get $CENTRAL /central/resumen | jq '{cobros, recaudado, recargado, conflictosAbiertos}'
```

✅ Esperado: `cobros 2` (Ana tramo 2 + Pedro), `recaudado 38000`, `recargado 160000`, `conflictosAbiertos 0`.

**Nuevo tabulador** (fecha futura: queda como "próximo" y avisa a todos):

```bash
post $CENTRAL /central/tabuladores '{"fuente":"Gaceta de prueba","vigenteDesde":"2026-12-01T04:00:00Z","descuentos":{"general":0,"estudiante":0.5,"exonerado":1},"recargoDomingoFeriado":0.2,"urbanoMinimo":25000,"suburbano":[{"hastaKm":10,"monto":35000},{"hastaKm":9999,"monto":120000}]}' | jq .urbanoMinimo
curl -s $API/publico/tarifas | jq '.proximo.urbanoMinimo'
get $ROSA /billetera | jq '.avisos[0].mensaje'
```

✅ Esperado: `25000`, `25000` y el aviso `"Nuevo pasaje desde el 1/12/2026: urbano 250,00 Bs"`.

**Categorías** (alguien se registra como estudiante):

```bash
NUEVO=$(curl -s -X POST $API/auth/registro -H 'Content-Type: application/json' -d '{"nombre":"Luisa Estudiante","telefono":"04241234567","clave":"1234","categoria":"estudiante"}' | jq -r .usuario.id)
get $CENTRAL /central/categorias/pendientes | jq '.[].nombre'
curl -s -X PUT $API/central/usuarios/$NUEVO/categoria -H "Authorization: Bearer $CENTRAL" -H 'Content-Type: application/json' -d '{"verificada":true}' | jq '{categoria, categoriaVerificada}'
```

✅ Esperado: `"Luisa Estudiante"` en pendientes, luego `estudiante` / `true`.

**Unidad nueva con recolector nuevo**:

```bash
post $CENTRAL /central/unidades '{"codigo":201,"placa":"AD789GH","lineaCodigo":2,"recolector":{"nombre":"Carlos Recolector","telefono":"04147770001","clave":"1234"}}' | jq '{codigo, lineaNombre, recolector: .recolector.nombre}'
CARLOS=$(login 04147770001); get $CARLOS /recolector/paquete | jq '.unidad.codigo, .linea.nombre'
```

✅ Esperado: unidad `201` en `"San Benito"` con Carlos, y Carlos ya puede cobrar (`201`, `"San Benito"`).

### 3.13 Fase 2: recibos del pasajero y rutas frecuentes

El teléfono del pasajero guarda un recibo en cada toque NFC y lo sube cuando tiene datos. Si llega antes que el cobro del recolector, **el cobro se crea con el recibo**, y el que llega segundo solo lo confirma.

```bash
RB=$(get $ROSA /boletos | jq -r '.[0].bid'); RR=$(get $ROSA /boletos | jq -r '.[0].raw')
T=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
post $ROSA /sync/recibos "{\"recibos\":[{\"bid\":\"$RB\",\"lineaCodigo\":1,\"unidadCodigo\":101,\"tramoCodigo\":1,\"monto\":0,\"ocurridoEn\":\"$T\"}]}" | jq -c '.resultados[0] | {estado, confirmadoPor: .cobro.confirmadoPor}'
post $LUIS /sync/cobros "{\"cobros\":[{\"raw\":\"$RR\",\"tramoCodigo\":1,\"monto\":0,\"metodo\":\"nfc\",\"ocurridoEn\":\"$T\"}]}" | jq -c '.resultados[0] | {estado, confirmadoPor: .cobro.confirmadoPor}'
get $ROSA /me/frecuentes | jq -c
```

✅ Esperado:

- recibo de Rosa: `{"estado":"ok","confirmadoPor":["pasajero"]}` (creó el cobro)
- cobro de Luis después: `{"estado":"ok","confirmadoPor":["pasajero","recolector"]}` (solo confirmó; no cobra dos veces)
- frecuentes: `[{"lineaCodigo":1,"tramoCodigo":1,"veces":1}]`

### 3.14 Límite de intentos de login

```bash
for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"telefono":"04149999999","clave":"0000"}'; done; echo
```

✅ Esperado: diez `401` y luego `429` (`DEMASIADOS_INTENTOS`). Ese teléfono queda frenado 15 min; los demás siguen entrando. Reiniciar el backend limpia el contador.

### 3.15 Volver a dejar todo limpio

```bash
npm run bd:reiniciar
```

---

## 4. Desde el teléfono o la laptop de otro

1. Tu IP: `hostname -I` (la primera, por ejemplo `192.168.1.50`).
2. Abre el puerto si hace falta: `sudo ufw allow 3001`.
3. En el navegador del teléfono (mismo wifi): `http://192.168.1.50:3001/api/v1/salud` → `{"ok":true,"bd":"ok"}`.
4. A Andy y Jose les pasas `http://192.168.1.50:3001/api/v1`. Desde su laptop pueden correr `npm run demo -- --base http://192.168.1.50:3001`.

Si no conecta: mismo wifi (no la red de invitados), firewall, y que `npm run dev` siga corriendo.

---

## 5. Ver los datos en Supabase

**SQL Editor** en Supabase (las tablas están en el esquema `pasaje`):

```sql
-- Saldos de todos
select u.nombre, b.saldo_disponible, b.saldo_reservado
from pasaje.billeteras b join pasaje.usuarios u on u.id = b.usuario_id;

-- Libro de movimientos de Ana, del más nuevo al más viejo
select tipo, monto, saldo_disponible_despues, creado_en
from pasaje.movimientos
where usuario_id = '00000000-0000-4000-8000-000000000001'
order by creado_en desc;

-- Cobros de hoy
select unidad_codigo, tramo_nombre, categoria_aplicada, monto, ocurrido_en, anulado_en
from pasaje.cobros order by ocurrido_en desc;
```

---

## Lista rápida

| # | Prueba | ✅ |
|---|---|---|
| 1 | `npm test` → 0 fail | ☐ |
| 2 | `npm run demo` completa | ☐ |
| 3.3 | Recarga suma al saldo | ☐ |
| 3.4 | 5 boletos de 14.000 para Ana | ☐ |
| 3.5 | Cobro ok + evento en vivo en la terminal 3 | ☐ |
| 3.6 | Reenviar = duplicado, no cobra doble | ☐ |
| 3.7 | Corregir devuelve el boleto | ☐ |
| 3.8 | Rechazos con su código | ☐ |
| 3.9 | Suburbana cobra 28.000 | ☐ |
| 3.10 | Doble gasto bloquea y aparece en la central | ☐ |
| 3.11 | Ubicación en el mapa | ☐ |
| 3.12 | Central: resumen, tabulador, categorías, unidad nueva | ☐ |
| 3.13 | Recibo crea el cobro y el recolector solo confirma | ☐ |
| 3.14 | Login frenado tras 10 intentos | ☐ |
| 4 | El teléfono llega a `/salud` | ☐ |
