const express = require('express');
const router = express.Router();
const db = require('./db');

// GET /api/sedes/:sedeSlug/servicios
// Devuelve los servicios activos de una sede
router.get('/:sedeSlug/servicios', async (req, res) => {
    try {
        const { sedeSlug } = req.params;

        const query = `
            SELECT s.id, s.nombre, s.prefijo, s.prioridad
            FROM servicios s
            JOIN sedes se ON se.id = s.sede_id
            WHERE se.slug = $1 AND s.activo = TRUE AND se.activo = TRUE
            ORDER BY s.prioridad DESC, s.nombre ASC;
        `;

        const result = await db.query(query, [sedeSlug]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener servicios: ', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET /api/sedes/:sedeSlug/modulos
// Devuelve los módulos activos de una sede
router.get('/sedeSlug/modulos', async (req, res) => {
    try {
        const { sedeSlug } = req.params;

        const query = `
            SELECT m.id, m.nombre
            FROM modulos m
            JOIN sedes se ON se.id = m.sede_id
            WHERE se.slug = $1 AND m.activo = TRUE;
        `;

        const result = await db.query(query, [sedeSlug]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener modulos: ', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// POST /api/sedes/:sedeSlug/tickets
// Genera un nuevo ticket
router.post('/:sedeSlug/tickets', async (req, res) => {
    const { sedeSlug } = req.params;
    const { servicioId } = req.body;

    if (!servicioId) {
        return res.status(400).json({ error: 'servicioID es requerido' });
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const sedeResult = await client.query('SELECT id FROM sedes WHERE slug = $1 AND activo = TRUE', [sedeSlug]);
        
        if (sedeResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({error:'Sede no encontrada o inactiva'});
        }
        const sedeId = sedeResult.rows[0].id;

        const insertQuery = `
            WITH info_servicio AS (
                SELECT prefijo, prioridad
                FROM servicios
                WHERE id = $1 AND sede_id = $2
            ),
            siguiente_numero AS (
                SELECT COALESCE(MAX(numero_consecutivo), 0) + 1 AS num
                FROM turnos
                WHERE sede_id = $2 AND servicio_id = $1 AND fecha = CURRENT_DATE
            )
            INSERT INTO turnos (
                sede_id, servicio_id, fecha, numero_consecutivo,
                codigo_completo, prioridad, estado
            )
            SELECT
                $2,
                $1,
                CURRENT_DATE,
                siguiente_numero.num,
                CONCAT(info_servicio.prefijo, '-', LPAD(siguiente_numero.num::TEXT, 3, '0')),
                info_servicio.prioridad,
                'ESPERANDO'
            FROM info_servicio, siguiente_numero
            RETURNING *;
        `;

        const ticketResult = await client.query(insertQuery, [servicioId, sedeId]);
        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            ticket: ticketResult.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al crear ticket:', error);
        res.status(500).json({ error: 'Error al generar el turno' });
    } finally {
        client.release();
    }
});

module.exports = router;