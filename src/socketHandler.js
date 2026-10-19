const db = require('./db');

module.exports = function(io) {
    io.on('connection', (socket) => {
        console.log(`Cliente conectado al socket: ${socket.id}`);

        socket.on('join:sede', (sedeSlug) => {
            socket.join(`sede_${sedeSlug}`);
            console.log(`Dispositivo ${socket.id} se unió a la sala: sede_${sedeSlug}`);
        });

        socket.on('advisor:call_next', async ({ sedeSlug, moduloID }, callback) => {
            const client = await db.getClient();
            try {
                await client.query('BEING');

                const sedeRes = await client.query('SELECT id FROM sedes WHERE slug = $1', [sedeSlug]);
                if (sedeRes.rows.length === 0) throw new Error('Sede no válida');
                const sedeId = sedeRes.rows[0].id;

                const selectQuery = `
                    SELECT t.id, t.codigo_completo
                    FROM turnos t
                    WHERE t.sede_id = $1
                        AND t.fecha = CURRENT_DATE
                        AND t.estado = 'ESPERANDO'
                        AND t.servicio_id IN (
                            SELECT servicio_id FROM modulo_servicios WHERE modulo_id = $2
                        )
                    ORDER BY t.prioridad DESC, t.creado_en ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED;
                `;
                const ticketRes = await client.query(selectQuery, [sedeId, moduloId]);

                if (ticketRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return callback({ success: false, message: 'No hay turnos en espera'});
                }

                const turnoId = ticketRes.rows[0].id;

                const updateQuery = `
                    UPDATE turnos
                    SET
                        estado = 'LLAMANDO',
                        modulo_id = $1,
                        llamado_en = CURRENT_TIMESTAMP,
                        intentos_llamado = intentos_llamado + 1
                    WHERE id = $2
                    RETURNING *;
                `;

                const updatedRes = await client.query(updateQuery, [moduloId, turnoId]);
                const moduloRes = await client.query('SELECT nombre FROM modulos WHERE id = $1', [moduloId]);
                const nombreModulo = moduloRes.rows[0].nombre;

                await client.query('COMMIT');

                const turnoLlamado = {
                    ...updatedRes.rows[0],
                    moduloNombre: nombreModulo
                };

                callback({ success: true, ticket: turnoLlamado});

                io.to(`sede_${sedeSlug}`).emit('ticket:called', {
                    id: turnoLlamado.id,
                    code: turnoLlamado.codigo_completo,
                    module: nombreModulo
                });

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error en advisor:call_next:', error);
                callback({ success: false, message: 'Error interno al llamar turno'});
            } finally {
                client.release();
            }
        });

        socket.on('advisor:finish', async ({ ticketId }) => {
            try {
                await db.query("UPDATE turnos SET estado = 'FINALIZADO', finalizado_en = CURRENT_TIMESTAMP WHERE id = $1", [ticketId]);
            } catch (err) {
                console.error('Error al finalizar turno:', err);
            }
        });
    });
};