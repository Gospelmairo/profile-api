'use strict';

/**
 * Database adapter — uses PostgreSQL when DATABASE_URL is set, otherwise SQLite.
 * This lets you develop locally without any setup, and deploy to any Postgres host.
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
        id            TEXT PRIMARY KEY,
        name          TEXT UNIQUE NOT NULL,
        gender        TEXT NOT NULL,
        gender_probability DOUBLE PRECISION NOT NULL,
        sample_size   INTEGER NOT NULL,
        age           INTEGER NOT NULL,
        age_group     TEXT NOT NULL,
        country_id    TEXT NOT NULL,
        country_probability DOUBLE PRECISION NOT NULL,
        created_at    TEXT NOT NULL
      )
    `);
  }

  async function findByName(name) {
    const { rows } = await pool.query(
      'SELECT * FROM profiles WHERE name = $1',
      [name]
    );
    return rows[0] || null;
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

  adapter = { init, findByName, insert };
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
      id            TEXT PRIMARY KEY,
      name          TEXT UNIQUE NOT NULL,
      gender        TEXT NOT NULL,
      gender_probability REAL NOT NULL,
      sample_size   INTEGER NOT NULL,
      age           INTEGER NOT NULL,
      age_group     TEXT NOT NULL,
      country_id    TEXT NOT NULL,
      country_probability REAL NOT NULL,
      created_at    TEXT NOT NULL
    )
  `);

  const stmtFind   = db.prepare('SELECT * FROM profiles WHERE name = ?');
  const stmtInsert = db.prepare(`
    INSERT INTO profiles
      (id, name, gender, gender_probability, sample_size, age, age_group, country_id, country_probability, created_at)
    VALUES
      (@id, @name, @gender, @gender_probability, @sample_size, @age, @age_group, @country_id, @country_probability, @created_at)
  `);

  adapter = {
    init: async () => {},
    findByName: async (name) => stmtFind.get(name) || null,
    insert: async (profile) => stmtInsert.run(profile),
  };
}

module.exports = adapter;
