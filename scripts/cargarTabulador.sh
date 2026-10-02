#!/usr/bin/env bash
# Carga un tabulador nuevo (gaceta) en un backend desplegado, como la central.
#   bash scripts/cargarTabulador.sh                      → producción (Render)
#   API=http://localhost:3001/api/v1 bash scripts/cargarTabulador.sh
# Pide todo por teclado; la clave no se muestra. Los montos se escriben en Bs (se envían en céntimos).
set -euo pipefail

API="${API:-https://pasaje-backend.onrender.com/api/v1}"
echo "Backend: $API"

read -r -p "Teléfono de la central [04140000003]: " TELEFONO
TELEFONO="${TELEFONO:-04140000003}"
read -r -s -p "Clave de la central: " CLAVE
echo

LOGIN=$(jq -n --arg t "$TELEFONO" --arg c "$CLAVE" '{telefono: $t, clave: $c}' |
  curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" -d @-)
TOKEN=$(jq -r '.token // empty' <<<"$LOGIN")
if [[ -z "$TOKEN" ]]; then
  echo "No se pudo entrar: $(jq -r '.error.mensaje // .' <<<"$LOGIN")"
  exit 1
fi
echo "Sesión iniciada."

FUENTE=""
while [[ ${#FUENTE} -lt 3 ]]; do
  read -r -p "Fuente, obligatoria (p. ej. Gaceta Oficial N° 43.123): " FUENTE
done
# Repregunta hasta que la respuesta (o el valor por defecto) cumpla el patrón.
preguntar() { # variable, texto, defecto, regex
  local valor
  while true; do
    read -r -p "$2 [$3]: " valor
    valor="${valor:-$3}"
    valor="${valor//[[:space:]]/}"
    if [[ "$valor" =~ $4 ]]; then printf -v "$1" '%s' "$valor"; return; fi
    echo "  Valor inválido: «$valor». Intenta de nuevo."
  done
}
NUMERO='^[0-9]+([.][0-9]+)?$'
FRACCION='^(0([.][0-9]+)?|1([.]0+)?)$'

AHORA=$(date -u +%Y-%m-%dT%H:%M:%SZ)
preguntar VIGENTE "Vigente desde (ISO UTC, Enter = ahora)" "$AHORA" '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z$'
preguntar URBANO "Pasaje urbano en Bs" 200 "$NUMERO"
preguntar SUB10 "Suburbano hasta 10 km en Bs" 280 "$NUMERO"
preguntar SUBMAX "Suburbano más de 10 km en Bs" 990 "$NUMERO"
preguntar EST "Descuento estudiante (0 a 1)" 0.5 "$FRACCION"
preguntar EXO "Descuento exonerado (0 a 1)" 0.5 "$FRACCION"
preguntar RECARGO "Recargo domingos y feriados (0 a 1; 0.05 = +5 %)" 0 "$FRACCION"

CUERPO=$(jq -n \
  --arg fuente "$FUENTE" --arg vigente "$VIGENTE" \
  --argjson urbano "$URBANO" --argjson sub10 "$SUB10" --argjson submax "$SUBMAX" \
  --argjson est "$EST" --argjson exo "$EXO" --argjson recargo "$RECARGO" \
  '{
    fuente: $fuente,
    vigenteDesde: $vigente,
    descuentos: { general: 0, estudiante: $est, exonerado: $exo },
    recargoDomingoFeriado: $recargo,
    urbanoMinimo: ($urbano * 100 | round),
    suburbano: [
      { hastaKm: 10, monto: ($sub10 * 100 | round) },
      { hastaKm: 9999, monto: ($submax * 100 | round) }
    ]
  }')

echo
echo "Se va a cargar este tabulador (montos en céntimos). Revisa la fuente y la fecha:"
jq . <<<"$CUERPO"
read -r -p "¿Cargarlo? (s/N): " OK
[[ "$OK" == "s" || "$OK" == "S" ]] || { echo "Cancelado, no se cargó nada."; exit 0; }

curl -s -X POST "$API/central/tabuladores" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$CUERPO" | jq .
