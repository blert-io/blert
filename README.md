# Blert

Blert is a PvM tracking and analytics platform for Old School RuneScape,
supporting Theatre of Blood, Colosseum, Inferno, and more.

This repository contains the codebase for the Blert website and backend
services.

---

## Project Structure

```
blert/
├── web/                # Frontend web app
├── socket-server/      # WebSocket event server
├── challenge-server/   # Processing and challenge handling
├── blertbank/          # Blertcoin accounts and ledger
├── common/             # Shared utilities and modules
└── compose.yaml        # Local development stack
```

---

## Setting up Blert locally

Follow these steps to get a full Blert development environment running.

### 1. Start the containers

```bash
docker compose up
```

This runs the websocket server, challenge server, database, and Redis
containers.

---

### 2. Prepare the database

You can either import sample data or initialize a fresh schema.

#### Option 1: Import a sample database dump

If you have a sample dump (e.g. `blert-sample-data.zip`):

1. Place the `.data` directory into the root of your Blert repository.
2. Import the SQL dump:

   ```bash
   psql 'postgres://blert:blert@localhost:5433/blert' -f blert-dump.sql
   ```

This loads a prebuilt dataset containing recorded ToB raid entries and a test
user.

#### Option 2: Create a fresh schema

If you don’t have a dump, you can create a new empty schema with:

```bash
export BLERT_DATABASE_URI='postgres://blert:blert@localhost:5433/blert'
npm run -w common migration:run
```

### 3. Install Node.js

Install Node **v24.8.0** using [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 24.8.0
nvm use
```

---

### 4. Install dependencies and build services

```bash
npm install
npm run -w common build
npm run -w socket-server build
npm run -w challenge-server build
```

---

## 5. Configure the web environment

A default environment file, `web/.env.development`, is included in the
repository for local Docker-based development.

```env
BLERT_DATABASE_URI=postgres://blert:blert@localhost:5433/blert
BLERT_REDIS_URI=redis://localhost:6379
AUTH_SECRET=blert
```

### Additional required paths

There are two extra environment variables needed by the web app, pointing to
directories in your filesystem.

If you imported a data dump, these directories should already exist. Otherwise,
create `.data/challenges` and `.data/web` in the root of your Blert repository.

Create `web/.env.local` and specify:

```env
BLERT_DATA_REPOSITORY=file:///path/to/blert/web/.data/challenges
BLERT_WEB_REPOSITORY=file:///path/to/blert/web/.data/web
```

---

### 6. Start the web app

In a separate terminal, run:

```bash
nvm use
npm run -w web dev
```

Visit [http://localhost:3000](http://localhost:3000) to verify the frontend is
running.

---

### 7. Create a local account

Once the site is running, open it in your browser and register a new account.
This creates a user in your local database.

---

## (Optional) Recording your own data

If you want to record and submit your own data using a local Blert plugin:

1. Allow API key creation

   In a `psql` shell connected to your local DB:

   ```sql
   UPDATE users
   SET can_create_api_key = true
   WHERE username = '<your username>';
   ```

2. Generate an API key

   Visit [http://localhost:3000/settings](http://localhost:3000/settings) while
   logged in and create a new API key.

3. Connect your Blert plugin

   Paste the API key into your local Blert plugin and start recording. Your
   data will stream into your local instance.

---

## Local development with Docker

The root of this repository includes a Docker compose file for running the
backend services required by Blert.

### Start the development servers

```bash
docker compose up
```

This starts the following services:

- **Websocket server** — `ws://localhost:3003`
- **Challenge processing server** — `http://localhost:3009`
- **Blertbank** — `http://localhost:3013`
- **Postgres** — `localhost:5433`
- **Redis** — `localhost:6379`

The web frontend is run separately.

---

## Running Tests

You can run each service's tests from the root via the `test` command in the
service's workspace:

```bash
npm run -w challenge-server test
```

---

## License

This project is licensed under the [MIT License](LICENSE).
