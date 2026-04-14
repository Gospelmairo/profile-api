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

/** Returns UTC ISO-8601 without milliseconds: 2026-04-01T12:00:00Z */
function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function errorBody(message) {
  return { status: 'error', message };
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'success', message: 'Profile API is running.' });
});

// ── POST /api/profiles ────────────────────────────────────────────────────────
app.post('/api/profiles', async (req, res) => {
  const { name } = req.body;

  // 1. Input validation
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

  // 2. Idempotency — return existing record without hitting external APIs again
  try {
    const existing = await db.findByName(normalizedName);
    if (existing) {
      return res.status(200).json({
        status: 'success',
        message: 'Profile already exists',
        data: {
          id:                 existing.id,
          name:               existing.name,
          gender:             existing.gender,
          gender_probability: Number(existing.gender_probability),
          sample_size:        Number(existing.sample_size),
          age:                Number(existing.age),
          age_group:          existing.age_group,
          country_id:         existing.country_id,
          country_probability: Number(existing.country_probability),
          created_at:         existing.created_at,
        },
      });
    }
  } catch (err) {
    console.error('DB lookup error:', err);
    return res.status(500).json(errorBody('Internal server error'));
  }

  // 3. Call all three external APIs in parallel
  let genderData, agifyData, nationalizeData;
  try {
    const [gRes, aRes, nRes] = await Promise.all([
      axios.get(`https://api.genderize.io/?name=${encodeURIComponent(normalizedName)}`),
      axios.get(`https://api.agify.io/?name=${encodeURIComponent(normalizedName)}`),
      axios.get(`https://api.nationalize.io/?name=${encodeURIComponent(normalizedName)}`),
    ]);
    genderData     = gRes.data;
    agifyData      = aRes.data;
    nationalizeData = nRes.data;
  } catch (err) {
    console.error('External API error:', err.message);
    const status = err.response ? 502 : 500;
    const msg    = err.response ? 'External API returned an error' : 'Failed to reach external API';
    return res.status(status).json(errorBody(msg));
  }

  // 4. Edge-case validation on API responses
  if (!genderData.gender || genderData.count === 0) {
    return res.status(422).json(errorBody('Insufficient gender data for this name'));
  }
  if (agifyData.age === null || agifyData.age === undefined) {
    return res.status(422).json(errorBody('Insufficient age data for this name'));
  }
  if (!nationalizeData.country || nationalizeData.country.length === 0) {
    return res.status(422).json(errorBody('Insufficient nationality data for this name'));
  }

  // 5. Aggregate & classify
  const gender             = genderData.gender;
  const gender_probability = genderData.probability;
  const sample_size        = genderData.count;

  const age      = agifyData.age;
  const age_group = classifyAge(age);

  const topCountry        = nationalizeData.country.reduce(
    (best, c) => (c.probability > best.probability ? c : best)
  );
  const country_id          = topCountry.country_id;
  const country_probability = topCountry.probability;

  // 6. Persist
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
          data: {
            id:                 existing.id,
            name:               existing.name,
            gender:             existing.gender,
            gender_probability: Number(existing.gender_probability),
            sample_size:        Number(existing.sample_size),
            age:                Number(existing.age),
            age_group:          existing.age_group,
            country_id:         existing.country_id,
            country_probability: Number(existing.country_probability),
            created_at:         existing.created_at,
          },
        });
      }
    }
    console.error('DB insert error:', err);
    return res.status(500).json(errorBody('Internal server error'));
  }

  // 7. Return created profile
  return res.status(201).json({
    status: 'success',
    data: {
      id,
      name:               normalizedName,
      gender,
      gender_probability,
      sample_size,
      age,
      age_group,
      country_id,
      country_probability,
      created_at,
    },
  });
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
