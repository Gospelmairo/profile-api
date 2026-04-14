# Profile API

A REST API that aggregates gender, age, and nationality predictions for a given name using three external APIs, then persists the result.

## Endpoint

### `POST /api/profiles`

Accepts a name, calls [Genderize](https://genderize.io), [Agify](https://agify.io), and [Nationalize](https://nationalize.io) in parallel, aggregates the data, and stores it.

**Idempotent** — submitting the same name twice returns the existing record.

#### Request body
```json
{ "name": "ella" }
```

#### Success response `201`
```json
{
  "status": "success",
  "data": {
    "id": "019601c3-7c2e-7000-8c3e-1f0a8e5b6d12",
    "name": "ella",
    "gender": "female",
    "gender_probability": 0.99,
    "sample_size": 1234,
    "age": 46,
    "age_group": "adult",
    "country_id": "DK",
    "country_probability": 0.85,
    "created_at": "2026-04-01T12:00:00Z"
  }
}
```

#### Already-exists response `200`
```json
{
  "status": "success",
  "message": "Profile already exists",
  "data": { ... }
}
```

#### Error response
```json
{ "status": "error", "message": "<reason>" }
```

| Condition | Status |
|---|---|
| Missing / empty `name` | 400 |
| `name` is not a string | 422 |
| Genderize returns `null` gender or `0` count | 422 |
| Agify returns `null` age | 422 |
| Nationalize returns no countries | 422 |
| External API unreachable | 502 |
| Server fault | 500 |

## Age group classification

| Range | Group |
|---|---|
| 0–12 | child |
| 13–19 | teenager |
| 20–59 | adult |
| 60+ | senior |

---

## Local development

```bash
npm install
node index.js
# SQLite database is created automatically at ./profiles.db
```

## Production deployment (Railway / Render / Fly.io)

1. Add a PostgreSQL add-on and copy the connection string.
2. Set the `DATABASE_URL` environment variable.
3. Deploy — the app will create the `profiles` table on first start.

### Environment variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | *(empty — uses SQLite)* |
| `DB_SSL` | Set `false` to disable SSL for local Postgres | `true` |
| `PORT` | HTTP port | `3000` |
