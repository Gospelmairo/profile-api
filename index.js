'use strict';

const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const { v7: uuidv7 } = require('uuid');
const db      = require('./db');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────
function classifyAge(age) {
  if (age <= 12)  return 'child';
  if (age <= 19)  return 'teenager';
  if (age <= 59)  return 'adult';
  return 'senior';
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function errorBody(message) {
  return { status: 'error', message };
}

function formatProfile(p) {
  return {
    id:                  p.id,
    name:                p.name,
    gender:              p.gender,
    gender_probability:  Number(p.gender_probability),
    sample_size:         Number(p.sample_size),
    age:                 Number(p.age),
    age_group:           p.age_group,
    country_id:          p.country_id,
    country_probability: Number(p.country_probability),
    created_at:          p.created_at,
  };
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'success', message: 'Profile API is running.' });
});

// ── POST /api/profiles ────────────────────────────────────────────────────────
app.post('/api/profiles', async (req, res) => {
  const { name } = req.body;

  // Input validation
  if (name === undefined || name === null || name === '') {
    return res.status(400).json(errorBody('Name is required'));
  }
  if (typeof name !== 'string') {
    return res.status(422).json(errorBody('Name must be a string'));
  }

  const normalizedName = name.trim().toLowerCase();
  if (normalizedName === '') {
    return res.status(400).json(errorBody('Name must not be blank'));
  }

  // Idempotency check
  try {
    const existing = await db.findByName(normalizedName);
    if (existing) {
      return res.status(200).json({
        status: 'success',
        message: 'Profile already exists',
        data: formatProfile(existing),
      });
    }
  } catch (err) {
    console.error('DB lookup error:', err);
    return res.status(500).json(errorBody('Internal server error'));
  }

  // Call all three external APIs in parallel
  let genderData, agifyData, nationalizeData;
  try {
    const [gRes, aRes, nRes] = await Promise.all([
      axios.get(`https://api.genderize.io/?name=${encodeURIComponent(normalizedName)}`),
      axios.get(`https://api.agify.io/?name=${encodeURIComponent(normalizedName)}`),
      axios.get(`https://api.nationalize.io/?name=${encodeURIComponent(normalizedName)}`),
    ]);
    genderData      = gRes.data;
    agifyData       = aRes.data;
    nationalizeData = nRes.data;
  } catch (err) {
    console.error('External API error:', err.message);
    return res.status(502).json(errorBody('External API returned an error'));
  }

  // Edge-case validation — each returns 502 naming the offending API
  if (!genderData.gender || genderData.count === 0) {
    return res.status(502).json(errorBody('Genderize returned an invalid response'));
  }
  if (agifyData.age === null || agifyData.age === undefined) {
    return res.status(502).json(errorBody('Agify returned an invalid response'));
  }
  if (!nationalizeData.country || nationalizeData.country.length === 0) {
    return res.status(502).json(errorBody('Nationalize returned an invalid response'));
  }

  // Aggregate & classify
  const gender             = genderData.gender;
  const gender_probability = genderData.probability;
  const sample_size        = genderData.count;

  const age       = agifyData.age;
  const age_group = classifyAge(age);

  const topCountry        = nationalizeData.country.reduce(
    (best, c) => (c.probability > best.probability ? c : best)
  );
  const country_id          = topCountry.country_id;
  const country_probability = topCountry.probability;

  // Persist
  const id         = uuidv7();
  const created_at = utcNow();

  const profile = {
    id, name: normalizedName, gender, gender_probability,
    sample_size, age, age_group, country_id, country_probability, created_at,
  };

  try {
    await db.insert(profile);
  } catch (err) {
    // Race condition: another request inserted the same name between our lookup and insert
    if (
      (err.code === 'SQLITE_CONSTRAINT' || err.code === '23505') &&
      err.message && err.message.toLowerCase().includes('unique')
    ) {
      const existing = await db.findByName(normalizedName);
      if (existing) {
        return res.status(200).json({
          status: 'success',
          message: 'Profile already exists',
          data: formatProfile(existing),
        });
      }
    }
    console.error('DB insert error:', err);
    return res.status(500).json(errorBody('Internal server error'));
  }

  return res.status(201).json({
    status: 'success',
    data: formatProfile(profile),
  });
});

// ── GET /api/profiles ─────────────────────────────────────────────────────────
app.get('/api/profiles', async (req, res) => {
  const { gender, country_id, age_group } = req.query;

  try {
    const rows = await db.findAll({
      gender:     gender     || undefined,
      country_id: country_id || undefined,
      age_group:  age_group  || undefined,
    });

    return res.status(200).json({
      status: 'success',
      count: rows.length,
      data: rows.map((p) => ({
        id:         p.id,
        name:       p.name,
        gender:     p.gender,
        age:        Number(p.age),
        age_group:  p.age_group,
        country_id: p.country_id,
      })),
    });
  } catch (err) {
    console.error('DB findAll error:', err);
    return res.status(500).json(errorBody('Internal server error'));
  }
});

// ── GET /api/profiles/:id ─────────────────────────────────────────────────────
app.get('/api/profiles/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const profile = await db.findById(id);
    if (!profile) {
      return res.status(404).json(errorBody('Profile not found'));
    }
    return res.status(200).json({
      status: 'success',
      data: formatProfile(profile),
    });
  } catch (err) {
    console.error('DB findById error:', err);
    return res.status(500).json(errorBody('Internal server error'));
  }
});

// ── DELETE /api/profiles/:id ──────────────────────────────────────────────────
app.delete('/api/profiles/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await db.deleteById(id);
    if (!deleted) {
      return res.status(404).json(errorBody('Profile not found'));
    }
    return res.status(204).send();
  } catch (err) {
    console.error('DB deleteById error:', err);
    return res.status(500).json(errorBody('Internal server error'));
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`Profile API listening on port ${PORT}`);
    console.log(`Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite (local)'}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
