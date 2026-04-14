'use strict';

/**
 * Database adapter — uses PostgreSQL when DATABASE_URL is set, otherwise SQLite.
 */

const DATABASE_URL = process.env.DATABASE_URL;

let adapter;

if (DATABASE_URL) {
  // ── PostgreSQL ────────────────────────────────────────────────────────────
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id                  TEXT PRIMARY KEY,
        name                TEXT UNIQUE NOT NULL,
        gender              TEXT NOT NULL,
        gender_probability  DOUBLE PRECISION NOT NULL,
        sample_size         INTEGER NOT NULL,
        age                 INTEGER NOT NULL,
        age_group           TEXT NOT NULL,
        country_id          TEXT NOT NULL,
        country_probability DOUBLE PRECISION NOT NULL,
        created_at          TEXT NOT NULL
      )
    `);
  }

  async function findByName(name) {
    const { rows } = await pool.query('SELECT * FROM profiles WHERE name = $1', [name]);
    return rows[0] || null;
  }

  async function findById(id) {
    const { rows } = await pool.query('SELECT * FROM profiles WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async function findAll(filters = {}) {
    const conditions = [];
    const values = [];
    let i = 1;

    if (filters.gender) {
      conditions.push(`LOWER(gender) = $${i++}`);
      values.push(filters.gender.toLowerCase());
    }
    if (filters.country_id) {
      conditions.push(`LOWER(country_id) = $${i++}`);
      values.push(filters.country_id.toLowerCase());
    }
    if (filters.age_group) {
      conditions.push(`LOWER(age_group) = $${i++}`);
      values.push(filters.age_group.toLowerCase());
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT * FROM profiles ${where}`, values);
    return rows;
  }

  async function insert(profile) {
    await pool.query(
      `INSERT INTO profiles
         (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_probability, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        profile.id, profile.name, profile.gender,
        profile.gender_probability, profile.sample_size,
        profile.age, profile.age_group,
        profile.country_id, profile.country_probability,
        profile.created_at,
      ]
    );
  }

  async function deleteById(id) {
    const { rowCount } = await pool.query('DELETE FROM profiles WHERE id = $1', [id]);
    return rowCount > 0;
  }

  adapter = { init, findByName, findById, findAll, insert, deleteById };

} else {
  // ── SQLite (local dev) ────────────────────────────────────────────────────
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    throw new Error('No DATABASE_URL set and better-sqlite3 is not available. Set DATABASE_URL to use PostgreSQL.');
  }
  const path = require('path');
  const db = new Database(path.join(__dirname, 'profiles.db'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id                  TEXT PRIMARY KEY,
      name                TEXT UNIQUE NOT NULL,
      gender              TEXT NOT NULL,
      gender_probability  REAL NOT NULL,
      sample_size         INTEGER NOT NULL,
      age                 INTEGER NOT NULL,
      age_group           TEXT NOT NULL,
      country_id          TEXT NOT NULL,
      country_probability REAL NOT NULL,
      created_at          TEXT NOT NULL
    )
  `);

  const stmtFindByName = db.prepare('SELECT * FROM profiles WHERE name = ?');
  const stmtFindById   = db.prepare('SELECT * FROM profiles WHERE id = ?');
  const stmtInsert     = db.prepare(`
    INSERT INTO profiles
      (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_probability, created_at)
    VALUES
      (@id, @name, @gender, @gender_probability, @sample_size, @age, @age_group, @country_id, @country_probability, @created_at)
  `);
  const stmtDelete = db.prepare('DELETE FROM profiles WHERE id = ?');

  function buildFindAll(filters = {}) {
    const conditions = [];
    const values = [];
    if (filters.gender)     { conditions.push('LOWER(gender) = ?');     values.push(filters.gender.toLowerCase()); }
    if (filters.country_id) { conditions.push('LOWER(country_id) = ?'); values.push(filters.country_id.toLowerCase()); }
    if (filters.age_group)  { conditions.push('LOWER(age_group) = ?');  values.push(filters.age_group.toLowerCase()); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM profiles ${where}`).all(...values);
  }

  adapter = {
    init:       async () => {},
    findByName: async (name) => stmtFindByName.get(name) || null,
    findById:   async (id)   => stmtFindById.get(id) || null,
    findAll:    async (f)    => buildFindAll(f),
    insert:     async (p)    => stmtInsert.run(p),
    deleteById: async (id)   => { const r = stmtDelete.run(id); return r.changes > 0; },
  };
}

module.exports = adapter;
