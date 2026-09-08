# Deploying the Backend (Beginner's Guide)

You don't need any DevOps experience for this. We'll use three services, all with a
generous **free tier that doesn't ask for a credit card**:

| Piece | Service | What it gives us |
|---|---|---|
| Database | [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) | A managed MongoDB database |
| Cache | [Upstash](https://console.upstash.com/) | A managed Redis database |
| API hosting | [Render](https://render.com/) | Runs the Docker container 24/7 on a public URL |

Total time: ~20-30 minutes. Everything is done by clicking around in each service's
website (a "dashboard") — no command line needed except two copy-pasted commands near
the end.

> **Why not just keep using ngrok?** Your frontend is currently pointed at an ngrok
> tunnel into your own laptop. That only works while your laptop is on, awake, and
> running `npm run start:dev` — and the ngrok URL changes every time it restarts. A
> real deployment gives you one stable URL that's always on.

---

## Step 0 — Make sure your code is pushed to GitHub

This repo already has a GitHub remote (`github.com/krupal-solulab/Bench-task-BE`).
Before continuing, push your latest commits:

```bash
git push origin main
```

Render deploys directly from this GitHub repo, so whatever is on GitHub is what
gets deployed — not what's on your laptop.

---

## Step 1 — Create the database (MongoDB Atlas)

1. Go to <https://www.mongodb.com/cloud/atlas/register> and sign up (Google sign-in
   is fastest).
2. It will ask you to create an "Organization" and "Project" — accept the defaults
   and click through.
3. When asked to **deploy a cluster**, choose the **M0 Free** tier. Pick any cloud
   provider/region (closest to you is fine). Click **Create**.
4. You'll be prompted to create a **database user** (this is a username/password for
   *your app* to log into the database — different from your Atlas login):
   - Username: `bench-api`
   - Password: click **Autogenerate Secure Password** and **copy it somewhere safe**
     right now (you can't see it again later).
5. Under **Network Access**, click **Add IP Address** → **Allow Access From
   Anywhere** (`0.0.0.0/0`). This is fine here because the database still requires
   the username/password from step 4 — nobody can get in without it.
6. Go to **Database → Connect → Drivers**, and copy the connection string. It looks
   like:
   ```
   mongodb+srv://bench-api:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. Replace `<password>` with the real password from step 4. **Save this full string
   — this is your `MONGO_URI`.**

Your `MONGO_DB_NAME` will just be `project_task_management` (or any name you like —
Atlas creates the database automatically the first time the app writes to it).

---

## Step 2 — Create the cache (Upstash Redis)

1. Go to <https://console.upstash.com/> and sign up.
2. Click **Create Database**. Name it anything (e.g. `bench-api-cache`), pick the
   **Global** or **Regional** free tier, and create it.
3. On the database's page, find the **REST API** / **Connect** section and copy the
   value labelled something like **"Redis Connect URL"** or **`UPSTASH_REDIS_URL`**
   — it looks like:
   ```
   rediss://default:AbCd1234@xxxx-xxxx.upstash.io:6379
   ```
   (Note the double-`s` in `rediss://` — that means it's encrypted. Our backend
   already understands this format.) **Save this — this is your `REDIS_URL`.**

---

## Step 3 — Generate two secret keys

The API needs two random secret strings to sign login tokens. **Don't reuse the ones
in your local `.env` file** — generate fresh ones for production.

If you have Node.js installed locally, run this command **twice** (once for each
line below) and save the two different outputs:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You'll get two long strings like `9f3a1c...`. Label the first one
`JWT_ACCESS_SECRET` and the second `JWT_REFRESH_SECRET`. They must be different from
each other.

(If you don't have Node.js handy, any "random password generator" website that gives
you a 40+ character string works too.)

---

## Step 4 — Deploy the API on Render

1. Go to <https://render.com/> and sign up with your GitHub account (this lets
   Render see your repos).
2. Click **New +** → **Web Service**.
3. Choose **Build and deploy from a Git repository**, then select
   `krupal-solulab/Bench-task-BE`.
4. Render will detect the `Dockerfile` automatically. Fill in:
   - **Name**: `bench-task-be` (or anything — this becomes part of your URL)
   - **Region**: closest to you
   - **Branch**: `main`
   - **Instance Type**: **Free**
5. Scroll to **Environment Variables** and add every one of these (click **Add
   Environment Variable** for each row):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `API_PREFIX` | `api/v1` |
   | `MONGO_URI` | *(the full connection string from Step 1)* |
   | `MONGO_DB_NAME` | `project_task_management` |
   | `REDIS_URL` | *(the URL from Step 2)* |
   | `JWT_ACCESS_SECRET` | *(first secret from Step 3)* |
   | `JWT_ACCESS_EXPIRES_IN` | `15m` |
   | `JWT_REFRESH_SECRET` | *(second secret from Step 3)* |
   | `JWT_REFRESH_EXPIRES_IN` | `7d` |
   | `BCRYPT_SALT_ROUNDS` | `12` |
   | `LOG_LEVEL` | `info` |
   | `THROTTLE_TTL` | `60` |
   | `THROTTLE_LIMIT` | `100` |
   | `AUTH_THROTTLE_LIMIT` | `5` |
   | `SWAGGER_ENABLED` | `true` |
   | `SEED_ADMIN_EMAIL` | `admin@example.com` |
   | `SEED_ADMIN_PASSWORD` | *(pick a real password — used in Step 6)* |

   Don't set `PORT` — Render sets this automatically and the app already respects it.

6. Click **Deploy Web Service**. Render will build the Docker image and start it —
   this takes a few minutes the first time. Watch the **Logs** tab; you're looking
   for a line like `Nest application successfully started`.
7. Once deployed, Render shows you the public URL at the top, something like:
   ```
   https://bench-task-be.onrender.com
   ```

---

## Step 5 — Verify it's actually working

Open these two URLs in your browser (replace with your real Render URL):

- `https://bench-task-be.onrender.com/api/v1/health` — should show
  `"status":"ok","mongo":"up","redis":"up"`. If `mongo` or `redis` show `"down"`,
  double-check the `MONGO_URI` / `REDIS_URL` values in Render's environment
  variables tab.
- `https://bench-task-be.onrender.com/api/docs` — the interactive API docs
  (Swagger). You should see every endpoint listed.

> **Free tier note:** Render's free web services "spin down" after 15 minutes of no
> traffic, and the next request takes ~30-50 seconds to wake it back up (a "cold
> start"). This is normal on the free tier — it's not broken. If this matters for a
> demo, open the `/health` URL right before you present.

---

## Step 6 — Load demo data into the production database

The seed script creates one Admin, one Manager, one Developer, and a demo project —
useful so there's something to show. Run it **from your own laptop**, pointed
temporarily at the production database:

1. Open `.env` in this repo and **note down your current values** (so you can put
   them back after).
2. Temporarily change just these two lines to your Atlas values from Step 1:
   ```
   MONGO_URI=mongodb+srv://bench-api:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   MONGO_DB_NAME=project_task_management
   ```
3. Also set `SEED_ADMIN_PASSWORD` in `.env` to match what you put in Render.
4. Run:
   ```bash
   npm run seed
   ```
   You should see `created: admin@example.com (Admin)` and similar lines.
5. **Put your `.env` back to its original local values** so your local dev setup
   still points at your local Docker Mongo/Redis.

---

## Step 7 — Point the frontend at the real backend

Your frontend is deployed on Vercel at `bench-task-fe-delta.vercel.app`, currently
using the ngrok URL. Update it to the real one:

1. Go to your project on <https://vercel.com/dashboard>.
2. **Settings → Environment Variables**.
3. Find `VITE_API_BASE_URL` and change its value to:
   ```
   https://bench-task-be.onrender.com/api/v1
   ```
   (use your actual Render URL from Step 4)
4. Save, then go to **Deployments** and click **Redeploy** on the latest deployment
   (env var changes don't apply until you redeploy).
5. Once redeployed, open `bench-task-fe-delta.vercel.app` and log in with the demo
   credentials from Step 6 (e.g. `admin@example.com` / whatever you set as
   `SEED_ADMIN_PASSWORD`).

You can now turn off ngrok and stop keeping your laptop's backend running — the
frontend talks to Render instead.

---

## What to do if something goes wrong

- **Render build fails** — click into the failed deploy's **Logs** tab and read the
  error near the bottom. Most common cause: a missing/misspelled environment
  variable name (compare against the table in Step 4).
- **`/health` shows `mongo: down`** — your Atlas connection string's password is
  wrong, or you forgot to allow `0.0.0.0/0` in Atlas's Network Access.
- **`/health` shows `redis: down`** — double check the `REDIS_URL` was pasted in
  full, including `rediss://`.
- **Frontend shows network/CORS errors** — the backend already allows requests from
  any origin, so this almost always means `VITE_API_BASE_URL` on Vercel doesn't
  match your Render URL exactly (check for a trailing slash or `http` vs `https`).
- **Login works but nothing shows up** — you probably haven't run Step 6 (seeding)
  against the production database yet.

## Later, if you outgrow the free tier

- Render's free tier sleeping after 15 minutes is the main limitation — Render's
  paid "Starter" plan (a few dollars/month) removes that.
- MongoDB Atlas M0 (free) caps out at 512MB storage — upgradeable in the same
  dashboard when needed.
- Rotate `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` periodically in a real production
  system (this logs everyone out, so do it during low traffic).
