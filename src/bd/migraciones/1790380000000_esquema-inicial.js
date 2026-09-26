// Esquema inicial de la fase 1 (docs/PLAN_FASE1.md). Dinero en céntimos (BIGINT).
// Todas las tablas viven en el esquema `pasaje`, fuera de la API pública de Supabase.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    -- Supabase crea los roles anon y authenticated; en local no existen.
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON SCHEMA pasaje FROM anon, authenticated;
      END IF;
    END $$;

    CREATE TABLE pasaje.usuarios (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre               TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
      telefono             TEXT NOT NULL UNIQUE,
      clave_hash           TEXT NOT NULL,
      rol                  TEXT NOT NULL CHECK (rol IN ('pasajero', 'recolector', 'central')),
      categoria            TEXT NOT NULL DEFAULT 'general'
                           CHECK (categoria IN ('general', 'estudiante', 'exonerado')),
      categoria_verificada BOOLEAN NOT NULL DEFAULT false,
      bloqueado            BOOLEAN NOT NULL DEFAULT false,
      creado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE pasaje.billeteras (
      usuario_id       UUID PRIMARY KEY REFERENCES pasaje.usuarios (id) ON DELETE CASCADE,
      saldo_disponible BIGINT NOT NULL DEFAULT 0 CHECK (saldo_disponible >= 0),
      saldo_reservado  BIGINT NOT NULL DEFAULT 0 CHECK (saldo_reservado >= 0),
      actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE pasaje.recargas (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      usuario_id UUID NOT NULL REFERENCES pasaje.usuarios (id),
      monto      BIGINT NOT NULL CHECK (monto > 0),
      metodo     TEXT NOT NULL CHECK (metodo IN ('simulada', 'pago_movil')),
      estado     TEXT NOT NULL CHECK (estado IN ('pendiente', 'confirmada', 'rechazada')),
      creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX recargas_usuario_idx ON pasaje.recargas (usuario_id, creado_en DESC);

    CREATE TABLE pasaje.tabuladores (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fuente                  TEXT NOT NULL,
      vigente_desde           TIMESTAMPTZ NOT NULL UNIQUE,
      descuentos              JSONB NOT NULL,
      recargo_domingo_feriado NUMERIC(5, 4) NOT NULL DEFAULT 0
                              CHECK (recargo_domingo_feriado BETWEEN 0 AND 1),
      urbano_minimo           BIGINT NOT NULL CHECK (urbano_minimo >= 0),
      suburbano               JSONB NOT NULL,
      creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE pasaje.feriados (
      fecha  DATE PRIMARY KEY,
      nombre TEXT NOT NULL
    );

    CREATE TABLE pasaje.lineas (
      id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      codigo    INTEGER NOT NULL UNIQUE CHECK (codigo BETWEEN 1 AND 65535),
      nombre    TEXT NOT NULL,
      tipo      TEXT NOT NULL CHECK (tipo IN ('urbana', 'suburbana')),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE pasaje.tramos (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      linea_id      UUID NOT NULL REFERENCES pasaje.lineas (id) ON DELETE CASCADE,
      codigo        INTEGER NOT NULL CHECK (codigo BETWEEN 1 AND 65535),
      nombre        TEXT NOT NULL,
      km            NUMERIC(6, 2) NOT NULL CHECK (km > 0),
      tarifa_manual BIGINT CHECK (tarifa_manual >= 0),
      UNIQUE (linea_id, codigo)
    );

    CREATE TABLE pasaje.unidades (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      codigo        INTEGER NOT NULL UNIQUE CHECK (codigo BETWEEN 1 AND 65535),
      placa         TEXT NOT NULL UNIQUE,
      linea_id      UUID NOT NULL REFERENCES pasaje.lineas (id),
      recolector_id UUID UNIQUE REFERENCES pasaje.usuarios (id)
    );

    CREATE TABLE pasaje.boletos (
      bid             UUID PRIMARY KEY,
      usuario_id      UUID NOT NULL REFERENCES pasaje.usuarios (id),
      categoria       TEXT NOT NULL CHECK (categoria IN ('general', 'estudiante', 'exonerado')),
      monto_reservado BIGINT NOT NULL CHECK (monto_reservado >= 0),
      expira_en       TIMESTAMPTZ NOT NULL,
      estado          TEXT NOT NULL DEFAULT 'activo'
                      CHECK (estado IN ('activo', 'usado', 'revocado', 'vencido')),
      creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX boletos_activos_usuario_idx ON pasaje.boletos (usuario_id) WHERE estado = 'activo';
    CREATE INDEX boletos_activos_expira_idx ON pasaje.boletos (expira_en) WHERE estado = 'activo';

    -- Los datos de línea, tramo y unidad se copian al cobrar: el historial no cambia
    -- si la central renombra un tramo o reasigna una unidad.
    CREATE TABLE pasaje.cobros (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bid                UUID NOT NULL REFERENCES pasaje.boletos (bid),
      pasajero_id        UUID NOT NULL REFERENCES pasaje.usuarios (id),
      recolector_id      UUID NOT NULL REFERENCES pasaje.usuarios (id),
      unidad_id          UUID NOT NULL REFERENCES pasaje.unidades (id),
      tramo_id           UUID NOT NULL REFERENCES pasaje.tramos (id),
      tabulador_id       UUID NOT NULL REFERENCES pasaje.tabuladores (id),
      linea_codigo       INTEGER NOT NULL,
      tramo_codigo       INTEGER NOT NULL,
      tramo_nombre       TEXT NOT NULL,
      unidad_codigo      INTEGER NOT NULL,
      categoria_aplicada TEXT NOT NULL
                         CHECK (categoria_aplicada IN ('general', 'estudiante', 'exonerado')),
      monto              BIGINT NOT NULL CHECK (monto >= 0),
      monto_recolector   BIGINT,
      metodo             TEXT NOT NULL CHECK (metodo IN ('nfc', 'qr')),
      ocurrido_en        TIMESTAMPTZ NOT NULL,
      sincronizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmado_por     TEXT[] NOT NULL,
      anulado_en         TIMESTAMPTZ
    );
    -- Un boleto solo se cobra una vez (los anulados no cuentan): idempotencia y doble gasto.
    CREATE UNIQUE INDEX cobros_bid_vigente_uq ON pasaje.cobros (bid) WHERE anulado_en IS NULL;
    CREATE INDEX cobros_tramo_idx ON pasaje.cobros (tramo_id, ocurrido_en);
    CREATE INDEX cobros_recolector_idx ON pasaje.cobros (recolector_id, ocurrido_en);
    CREATE INDEX cobros_pasajero_idx ON pasaje.cobros (pasajero_id, ocurrido_en);

    -- El segundo uso de un bid ya cobrado (doble gasto) se guarda aquí, no en cobros.
    CREATE TABLE pasaje.conflictos (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bid               UUID NOT NULL REFERENCES pasaje.boletos (bid),
      cobro_original_id UUID NOT NULL REFERENCES pasaje.cobros (id),
      pasajero_id       UUID NOT NULL REFERENCES pasaje.usuarios (id),
      recolector_id     UUID NOT NULL REFERENCES pasaje.usuarios (id),
      unidad_id         UUID NOT NULL REFERENCES pasaje.unidades (id),
      monto             BIGINT NOT NULL,
      ocurrido_en       TIMESTAMPTZ NOT NULL,
      creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
      resuelto_en       TIMESTAMPTZ
    );

    -- Libro de movimientos: solo inserción (ver trigger abajo).
    CREATE TABLE pasaje.movimientos (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      usuario_id               UUID NOT NULL REFERENCES pasaje.usuarios (id),
      tipo                     TEXT NOT NULL
                               CHECK (tipo IN ('recarga', 'reserva', 'cobro', 'liberacion')),
      monto                    BIGINT NOT NULL,
      saldo_disponible_despues BIGINT NOT NULL CHECK (saldo_disponible_despues >= 0),
      recarga_id               UUID REFERENCES pasaje.recargas (id),
      boleto_bid               UUID REFERENCES pasaje.boletos (bid),
      cobro_id                 UUID REFERENCES pasaje.cobros (id),
      creado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX movimientos_usuario_idx ON pasaje.movimientos (usuario_id, creado_en DESC);

    CREATE FUNCTION pasaje.impedir_cambios_movimientos() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'movimientos es solo inserción: no se puede % ', TG_OP;
    END $$ LANGUAGE plpgsql;

    CREATE TRIGGER movimientos_solo_insercion
      BEFORE UPDATE OR DELETE ON pasaje.movimientos
      FOR EACH ROW EXECUTE FUNCTION pasaje.impedir_cambios_movimientos();

    CREATE TABLE pasaje.ubicaciones_unidad (
      unidad_id      UUID PRIMARY KEY REFERENCES pasaje.unidades (id) ON DELETE CASCADE,
      lat            DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
      lng            DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- usuario_id NULL = aviso para todos los pasajeros.
    CREATE TABLE pasaje.avisos (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      usuario_id    UUID REFERENCES pasaje.usuarios (id) ON DELETE CASCADE,
      tipo          TEXT NOT NULL CHECK (tipo IN (
                      'CAMBIO_TARIFA', 'CATEGORIA_APROBADA', 'CATEGORIA_RECHAZADA', 'CUENTA_BLOQUEADA'
                    )),
      mensaje       TEXT NOT NULL,
      vigente_desde TIMESTAMPTZ,
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX avisos_usuario_idx ON pasaje.avisos (usuario_id, creado_en DESC);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS
      pasaje.avisos, pasaje.ubicaciones_unidad, pasaje.movimientos, pasaje.conflictos,
      pasaje.cobros, pasaje.boletos, pasaje.unidades, pasaje.tramos, pasaje.lineas,
      pasaje.feriados, pasaje.tabuladores, pasaje.recargas, pasaje.billeteras, pasaje.usuarios
    CASCADE;
    DROP FUNCTION IF EXISTS pasaje.impedir_cambios_movimientos();
  `);
};
