const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { Pool } = require('pg'); // Importa el cliente de PostgreSQL
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Render configurará esta variable
    ssl: {
        rejectUnauthorized: false // Necesario para entornos en la nube
    }
});

// Crear la tabla si no existe
pool.query(`
    CREATE TABLE IF NOT EXISTS commitments (
        id SERIAL PRIMARY KEY,
        leaderName TEXT,
        commitment TEXT,
        responsible TEXT,
        municipality TEXT,
        observation TEXT,
        responsibleEmail TEXT,
        userId TEXT,
        state TEXT DEFAULT 'Activo',
        creationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(err => console.error('Error al crear la tabla:', err));

// Configuración del transporte de correos
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'juanfelipegilmora2024@gmail.com',
        pass: 'nnmihybpnvvtiqqz' // Contraseña de aplicación generada en Gmail
    }
});

// Endpoint para guardar un compromiso
app.post('/commitments', async (req, res) => {
    const { leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId } = req.body;

    try {
        const query = `
            INSERT INTO commitments (leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;
        const values = [leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId];

        const result = await pool.query(query, values);

        // Enviar correo al responsable
        await transporter.sendMail({
            from: 'juanfelipegilmora2024@gmail.com',
            to: responsibleEmail,
            subject: 'Nuevo compromiso asignado',
            text: `Hola ${responsible},\n\nSe ha asignado un nuevo compromiso:\n\nCompromiso: ${commitment}\nMunicipio: ${municipality}\n\nGracias.`
        });

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al guardar el compromiso:', err.message);
        res.status(500).send('Error al guardar el compromiso.');
    }
});

// Endpoint para obtener compromisos por usuario
app.get('/commitments/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const query = `SELECT * FROM commitments WHERE userId = $1`;
        const result = await pool.query(query, [userId]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener compromisos:', err.message);
        res.status(500).send('Error al obtener compromisos.');
    }
});

// Endpoint para el admin: obtener todos los compromisos
app.get('/admin/commitments', async (req, res) => {
    try {
        const query = `SELECT * FROM commitments`;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener todos los compromisos:', err.message);
        res.status(500).send('Error al obtener compromisos.');
    }
});

// Tarea programada para verificar estados
schedule.scheduleJob('*/1 * * * *', async () => {
    console.log('Ejecutando la tarea diaria para verificar estados...');
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
                const updateQuery = `UPDATE commitments SET state = $1 WHERE id = $2`;
                await pool.query(updateQuery, [newState, commitment.id]);

                // Enviar correo al responsable por cambio de estado
                await transporter.sendMail({
                    from: 'juanfelipegilmora2024@gmail.com',
                    to: commitment.responsibleEmail,
                    subject: `Cambio de estado a ${newState}`,
                    text: `Hola ${commitment.responsible},\n\nEl compromiso "${commitment.commitment}" ha cambiado a estado ${newState}.\n\nGracias.`
                });

                console.log(`Estado actualizado a ${newState} para el compromiso con ID ${commitment.id}`);
            }
        }
    } catch (err) {
        console.error('Error al ejecutar la tarea programada:', err.message);
    }
});

// Ruta raíz para manejar GET /
app.get('/', (req, res) => {
    res.send('Bienvenido a la API de Gestión de Compromisos');
});

// Inicia el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

