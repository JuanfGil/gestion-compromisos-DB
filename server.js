const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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

// Endpoint para obtener compromisos por usuario
app.get('/commitments/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const query = `SELECT * FROM commitments WHERE userId = $1`;
        const result = await pool.query(query, [userId]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener compromisos:', err.message);
        res.status(500).json({ error: 'Error al obtener compromisos.', detalle: err.message });
    }
});

// Endpoint para obtener todos los compromisos (vista de administrador)
app.get('/admin/commitments', async (req, res) => {
    try {
        const query = `SELECT * FROM commitments`;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener todos los compromisos:', err.message);
        res.status(500).json({ error: 'Error al obtener todos los compromisos.', detalle: err.message });
    }
});

// Endpoint para guardar un compromiso
app.post('/commitments', async (req, res) => {
    const { leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate } = req.body;

    try {
        const query = `
            INSERT INTO commitments (leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;
        const values = [leaderName, commitment, responsible, municipality, observation, responsibleEmail, userId, creationDate];

        const result = await pool.query(query, values);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al guardar el compromiso:', err.message);
        res.status(500).json({ error: 'Error al guardar el compromiso.', detalle: err.message });
    }
});

// Endpoint para eliminar un compromiso
app.delete('/commitments/:id', async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    if (password !== 'admin123') {
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    try {
        const query = `DELETE FROM commitments WHERE id = $1 RETURNING *`;
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

// Ruta de prueba para verificar que el servidor está en funcionamiento
app.get('/', (req, res) => {
    res.send('API de Gestión de Compromisos en funcionamiento.');
});

// Inicia el servidor
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
