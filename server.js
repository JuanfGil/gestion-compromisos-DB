const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { Pool } = require('pg');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.query(`
    CREATE TABLE IF NOT EXISTS commitments (
        id SERIAL PRIMARY KEY,
        leaderName TEXT,
        commitment TEXT,
        responsible TEXT,
        municipality TEXT,
        observation TEXT,
        responsibleEmail TEXT,
        state TEXT DEFAULT 'Activo',
        creationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(err => console.error('Error al crear la tabla:', err));

app.post('/commitments', async (req, res) => {
    const { leaderName, commitment, responsible, municipality, observation, responsibleEmail, creationDate } = req.body;
    const result = await pool.query(`
        INSERT INTO commitments (leaderName, commitment, responsible, municipality, observation, responsibleEmail, creationDate)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, 
        [leaderName, commitment, responsible, municipality, observation, responsibleEmail, creationDate]);
    res.status(201).json(result.rows[0]);
});

app.get('/commitments', async (req, res) => {
    const result = await pool.query('SELECT * FROM commitments');
    res.status(200).json(result.rows);
});

app.get('/admin/commitments', async (req, res) => {
    const result = await pool.query('SELECT * FROM commitments');
    res.status(200).json(result.rows);
});

app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));


