const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { Pool } = require('pg');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    next();
});


// Configuración de la base de datos PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL + "?sslmode=require"
});

// Agregar columna avanceCompromiso si no existe
pool.query(`
    ALTER TABLE commitments ADD COLUMN IF NOT EXISTS avanceCompromiso TEXT DEFAULT '';
`).catch(err => console.error('Error al modificar la tabla:', err));

// Guardar un avance en un compromiso
app.post('/commitments/:id/avance', async (req, res) => {
    const { id } = req.params;
    const { avance } = req.body;

    try {
        const query = 'UPDATE commitments SET avanceCompromiso = $1 WHERE id = $2 RETURNING *';
        const result = await pool.query(query, [avance, id]);

        if (result.rowCount > 0) {
            res.status(200).json({ message: 'Avance guardado correctamente.', compromiso: result.rows[0] });
        } else {
            res.status(404).json({ error: 'Compromiso no encontrado.' });
        }
    } catch (err) {
        console.error('Error al guardar el avance:', err.message);
        res.status(500).json({ error: 'Error al guardar el avance.' });
    }
});

// Configuración del transporte de correos
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'enriquezroserot@gmail.com',
        pass: 'wknyrrdzhtgjymgn'
    }
});

// Crear la tabla si no existe
pool.query(`
    CREATE TABLE IF NOT EXISTS commitments (
        id SERIAL PRIMARY KEY,
        leaderName TEXT NOT NULL,
        leaderPhone TEXT NOT NULL,
        commitment TEXT NOT NULL,
        responsible TEXT NOT NULL,
        responsibleEmail TEXT NOT NULL,
        municipality TEXT NOT NULL,
        observation TEXT DEFAULT '',
        userId TEXT NOT NULL,
        state TEXT DEFAULT 'Activo',
        creationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(err => console.error('Error al crear la tabla:', err));

// Obtener compromisos por usuario
app.get('/commitments/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const query = 'SELECT * FROM commitments WHERE userId = $1';
        const result = await pool.query(query, [userId]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener compromisos:', err.message);
        res.status(500).json({ error: 'Error al obtener compromisos' });
    }
});

// Obtener todos los compromisos (vista de administrador)
app.get('/admin/commitments', async (req, res) => {
    try {
        const query = 'SELECT * FROM commitments';
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener todos los compromisos:', err.message);
        res.status(500).json({ error: 'Error al obtener todos los compromisos' });
    }
});

// Guardar un nuevo compromiso
app.post('/commitments', async (req, res) => {
    const { leaderName, leaderPhone, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate } = req.body;

    try {
        const duplicateCheck = await pool.query(`SELECT * FROM commitments WHERE commitment = $1 AND userId = $2`, [commitment, userId]);
        if (duplicateCheck.rows.length > 0) {
            return res.status(400).json({ error: 'El compromiso ya existe.' });
        }

        const query = `
            INSERT INTO commitments (leaderName, leaderPhone, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
        const values = [leaderName, leaderPhone, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate];

        const result = await pool.query(query, values);

        await transporter.sendMail({
            from: 'enriquezroserot@gmail.com',
            to: ['juanfelipegilmora2024@gmail.com'],
            subject: 'Nuevo compromiso asignado',
            text: `Hola ${responsible},\n\nSe ha asignado un nuevo compromiso:\n\nCompromiso: ${commitment}\nMunicipio: ${municipality}\n\nGracias.`
        });

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al guardar el compromiso:', err.message);
        res.status(500).json({ error: 'Error al guardar el compromiso.', detalle: err.message });
    }
});

// Actualizar estado de un compromiso
app.put('/commitments/:id', async (req, res) => {
    const { id } = req.params;
    const { state, observation } = req.body;

    try {
        const result = await pool.query(
            'UPDATE commitments SET state = $1, observation = $2 WHERE id = $3 RETURNING *',
            [state, observation, id]
        );

        if (result.rowCount > 0) {
            const updatedCommitment = result.rows[0];

            // Enviar correo al responsable y otros destinatarios
            const mailOptions = {
                from: 'enriquezroserot@gmail.com',
                to: ['juanfelipegilmora2024@gmail.com'],
                subject: `Actualización de estado: ${updatedCommitment.state}`,
                text: `Hola ${updatedCommitment.responsible},\n\nEl compromiso "${updatedCommitment.commitment}" ahora tiene el estado "${updatedCommitment.state}".\n\nSaludos.`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error(`❌ Error al enviar correo a ${updatedCommitment.responsibleEmail}:`, error.message);
                } else {
                    console.log(`📧 Correo enviado a ${updatedCommitment.responsibleEmail}: ${info.response}`);
                }
            });

            res.status(200).json(updatedCommitment);
        } else {
            res.status(404).json({ error: 'Compromiso no encontrado.' });
        }
    } catch (err) {
        console.error('Error al actualizar el compromiso:', err.message);
        res.status(500).send('Error al actualizar el compromiso.');
    }
});


/ Tarea programada para actualizar estados automáticamente y enviar notificación
schedule.scheduleJob('0 0 * * *', async () => { // Ejecuta la tarea todos los días a medianoche
    console.log('🔍 Ejecutando tarea programada para verificar y actualizar estados...');

    try {
        const query = 'SELECT id, commitment, responsibleEmail, responsible, creationdate, state FROM commitments';
        const result = await pool.query(query);
        const now = new Date();

        console.log(`📌 Se encontraron ${result.rows.length} compromisos en la base de datos.`);

        for (const commitment of result.rows) {
            console.log(`📌 Compromiso ID: ${commitment.id} - Estado Actual: ${commitment.state}`);

            const creationDate = new Date(commitment.creationdate);
            if (isNaN(creationDate.getTime())) {
                console.error(`❌ ERROR: Fecha inválida para compromiso con ID ${commitment.id}`);
                continue;
            }

            // Calcular diferencia en días
            const diffInDays = Math.floor((now - creationDate) / (1000 * 60 * 60 * 24));
            let newState = commitment.state;

            if (commitment.state !== 'Cumplido') { // No cambiar si ya está cumplido
                if (diffInDays > 30 && commitment.state !== 'Vencido') {
                    newState = 'Vencido';
                } else if (diffInDays > 15 && commitment.state !== 'Pendiente') {
                    newState = 'Pendiente';
                }
            }

            // Si el estado cambia, actualizarlo en la base de datos y enviar correo
            if (newState !== commitment.state) {
                await pool.query('UPDATE commitments SET state = $1 WHERE id = $2', [newState, commitment.id]);

                console.log(`✅ Estado actualizado a ${newState} para el compromiso con ID ${commitment.id}`);

                // Enviar correo al responsable + otros destinatarios
                const mailOptions = {
                    from: 'enriquezroserot@gmail.com',
                    to: [commitment.responsibleemail, 'enriquezroserot@gmail.com', 'rossiobp@gmail.com'],
                    subject: `Cambio de estado: ${newState}`,
                    text: `Hola ${commitment.responsible},\n\nEl compromiso "${commitment.commitment}" ha cambiado a estado "${newState}".\n\nPor favor, revisa el sistema para más detalles.\n\nSaludos.`
                };

                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.error(`❌ Error al enviar correo a ${commitment.responsibleemail}:`, error.message);
                    } else {
                        console.log(`📧 Correo enviado a ${commitment.responsibleemail}, enriquezroserot@gmail.com, rossiobp@gmail.com: ${info.response}`);
                    }
                });
            }
        }

        console.log('✅ Verificación, actualización y notificación de estados completada.');
    } catch (err) {
        console.error('❌ Error en la actualización de estados:', err.message);
    }
});


// Eliminar un compromiso
app.delete('/commitments/:id', async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    if (password !== 'geo2026') {
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    try {
        const query = 'DELETE FROM commitments WHERE id = $1 RETURNING *';
        const result = await pool.query(query, [id]);

        if (result.rowCount > 0) {
            res.status(200).json({ message: 'Compromiso eliminado.' });
        } else {
            res.status(404).json({ error: 'Compromiso no encontrado.' });
        }
    } catch (err) {
        console.error('Error al eliminar el compromiso:', err.message);
        res.status(500).send('Error al eliminar el compromiso.');
    }
});


// Ruta de prueba
app.get('/', (req, res) => {
    res.send('API de Gestión de Compromisos en funcionamiento.');
});

// Inicia el servidor
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
