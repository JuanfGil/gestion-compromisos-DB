const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { Pool } = require('pg');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Configuración del transporte de correos
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'juanfelipegilmora2024@gmail.com',
        pass: 'nnmihybpnvvtiqqz'
    }
});

// Verificar conexión a la base de datos
pool.connect()
    .then(() => console.log('Conexión a la base de datos exitosa'))
    .catch((err) => console.error('Error al conectar a la base de datos:', err.message));

// Crear la tabla si no existe
pool.query(`
    CREATE TABLE IF NOT EXISTS commitments (
        id SERIAL PRIMARY KEY,
        leaderName TEXT NOT NULL,
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

// Endpoint para guardar un compromiso
app.post('/commitments', async (req, res) => {
    const { leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate } = req.body;

    try {
        // Verificar si ya existe el compromiso
        const duplicateCheck = await pool.query(`SELECT * FROM commitments WHERE commitment = $1 AND userId = $2`, [commitment, userId]);
        if (duplicateCheck.rows.length > 0) {
            return res.status(400).json({ error: 'El compromiso ya existe.' });
        }

        const query = `
            INSERT INTO commitments (leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;
        const values = [leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate];

        const result = await pool.query(query, values);

        // Enviar correo al responsable y al correo fijo
        await transporter.sendMail({
            from: 'juanfelipegilmora2024@gmail.com',
            to: [responsibleEmail, 'juanfelipegilmora2024@gmail.com'],
            subject: 'Nuevo compromiso asignado',
            text: `Hola ${responsible},\n\nSe ha asignado un nuevo compromiso:\n\nCompromiso: ${commitment}\nMunicipio: ${municipality}\n\nGracias.`
        });

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al guardar el compromiso:', err.message);
        res.status(500).json({ error: 'Error al guardar el compromiso.', detalle: err.message });
    }
});

// Endpoint para actualizar el estado y enviar correos
app.put('/commitments/:id', async (req, res) => {
    const { id } = req.params;
    const { state, observation } = req.body;

    try {
        const query = `UPDATE commitments SET state = $1, observation = $2 WHERE id = $3 RETURNING *`;
        const result = await pool.query(query, [state, observation, id]);

        if (result.rowCount > 0) {
            const updatedCommitment = result.rows[0];

            // Enviar correo por cambio de estado
            await transporter.sendMail({
                from: 'juanfelipegilmora2024@gmail.com',
                to: [updatedCommitment.responsibleEmail, 'juanfelipegilmora2024@gmail.com'],
                subject: `Actualización de estado: ${state}`,
                text: `Hola ${updatedCommitment.responsible},\n\nEl compromiso "${updatedCommitment.commitment}" ahora tiene el estado "${state}".\n\nGracias.`
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

// Tarea programada para actualizar estados automáticamente
schedule.scheduleJob('0 0 * * *', async () => {
    console.log('Ejecutando tarea diaria para actualizar estados...');
    try {
        const query = `SELECT * FROM commitments`;
        const result = await pool.query(query);
        const now = new Date();

        for (const commitment of result.rows) {
            const creationDate = new Date(commitment.creationDate);
            const diffInDays = Math.floor((now - creationDate) / (1000 * 60 * 60 * 24));
            let newState = commitment.state;

            if (diffInDays > 30 && commitment.state !== 'Vencido') {
                newState = 'Vencido';
            } else if (diffInDays > 15 && commitment.state !== 'Pendiente') {
                newState = 'Pendiente';
            }

            if (newState !== commitment.state) {
                await pool.query(`UPDATE commitments SET state = $1 WHERE id = $2`, [newState, commitment.id]);

                // Enviar correos
                await transporter.sendMail({
                    from: 'juanfelipegilmora2024@gmail.com',
                    to: [commitment.responsibleEmail, 'juanfelipegilmora2024@gmail.com'],
                    subject: `Cambio de estado a ${newState}`,
                    text: `Hola ${commitment.responsible},\n\nEl compromiso "${commitment.commitment}" ha cambiado a estado "${newState}".\n\nGracias.`
                });

                console.log(`Estado actualizado a ${newState} para el compromiso con ID ${commitment.id}`);
            }
        }
    } catch (err) {
        console.error('Error en la tarea programada:', err.message);
    }
});

// Ruta de prueba para verificar que el servidor está en funcionamiento
app.get('/', (req, res) => {
    res.send('API de Gestión de Compromisos en funcionamiento.');
});

// Inicia el servidor
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
