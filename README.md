# FreshLens BFF — TrueNAS recipe API

Backend-for-frontend recipe search for [FreshLens](https://github.com/LatSalmonMan/FreshLens_AI).
Postgres + Express on port **3080**. Loads ~2.2M recipes from RecipeNLG-style `full_dataset.csv`.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Fast count estimate; `?exact=1` for true count |
| GET/POST | `/recipes/search` | Pantry match (`?ingredients=chicken,rice`) |
| GET | `/recipes/:id` | Ingredients + steps (`r0`, `r123`, …) |

---

## TrueNAS SCALE setup

### 1. Dataset layout

Create (or reuse) a dataset, e.g. under pool **SwimmingPool**:

```
/mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset/
  app/          ← clone / copy of this repo
  data/         ← put full_dataset.csv or .csv.gz here
  pgdata/       ← empty; Postgres owns this
```

```bash
mkdir -p /mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset/{app,data,pgdata}
```

Copy the CSV into `data/` (from your Mac share or `scp`). Prefer gzip:

```bash
# on Mac
gzip -k -6 ~/Downloads/dataset/full_dataset.csv
# copy full_dataset.csv.gz into the dataset's data/ folder via SMB/SFTP
```

### 2. Get this repo onto the NAS

**Option A — git clone (if NAS can reach GitHub):**

```bash
cd /mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset
git clone https://github.com/LatSalmonMan/FreshLensBFF.git app
cd app
cp .env.example .env
# edit HOST_* paths in .env if your dataset path differs
```

**Option B — copy files via SMB** from your Mac into `app/`.

### 3. Install as a Custom App (Docker Compose)

TrueNAS SCALE (Electric Eel / Docker):

1. **Apps** → **Discover Apps** → **Custom App** (or Install via YAML / Compose)
2. Paste or point at this repo’s `docker-compose.yml`
3. Ensure `.env` is next to the compose file with correct `HOST_DATA_DIR` and `HOST_PGDATA_DIR`
4. Deploy

Or from SSH on the NAS:

```bash
cd /mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset/app
docker compose up -d --build
```

Do **not** publish Postgres `5432` to the LAN unless you need it.

### 4. Import recipes (one-shot)

```bash
cd /mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset/app

# Smoke test
docker compose --profile import run --rm importer -- --limit 50000 --file /data/full_dataset.csv.gz

curl "http://127.0.0.1:3080/health?exact=1"
curl "http://127.0.0.1:3080/recipes/search?ingredients=chicken,rice,onion"

# Full catalog (~1 hour depending on NAS CPU/disk)
docker compose --profile import run --rm importer -- --truncate --file /data/full_dataset.csv.gz
```

Uncompressed CSV:

```bash
docker compose --profile import run --rm importer -- --truncate --file /data/full_dataset.csv
```

### 5. Point FreshLens at the NAS

On your phone/Mac, home Wi‑Fi only (unless you add a tunnel later).

FreshLens `.env`:

```bash
EXPO_PUBLIC_RECIPE_API_URL=http://<NAS-LAN-IP>:3080
```

Restart Expo (`npx expo start -c`). Find recipes uses the BFF; if NAS is down it falls back to the small on-device catalog.

---

## Local Mac / Linux (optional)

```bash
cp .env.example .env
# set HOST_DATA_DIR=./data HOST_PGDATA_DIR=./pgdata
mkdir -p data pgdata
# put a CSV (or small sample) in data/
docker compose up -d --build
docker compose --profile import run --rm importer -- --limit 1000 --file /data/full_dataset.csv
```

Small JSON seed (dev only):

```bash
# mount recipes.json into /data and:
docker compose run --rm -v "$(pwd)/data:/data:ro" api node src/seed.js
```

---

## Resources

- Full import wants free disk for Postgres (~15–25 GB peak) and preferably **≥8 GB RAM** on the NAS for comfort
- Dataset has **no images** — cards are title-only
- RecipeNLG / scraped sources: fine for **private** use; not a clean commercial license

## Repo layout

```
Dockerfile
docker-compose.yml
.env.example
src/          # Express API + CSV importer
sql/          # schema + post-load indexes
data/         # mount point for CSV (gitignored contents)
```
