# FreshLens BFF — TrueNAS recipe API

Backend-for-frontend recipe search for FreshLens.
Postgres + Express on port **3080**. Image: **`ghcr.io/latsalmonman/freshlens-bff`**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Fast estimate; `?exact=1` for exact count |
| GET/POST | `/recipes/search` | `?ingredients=chicken,rice` |
| GET | `/recipes/:id` | e.g. `r0` |

---

## Publish (GitHub Actions)

Pushes to `main` build and publish:

`ghcr.io/latsalmonman/freshlens-bff:latest`

After the first run, open the package on GitHub → **Package settings** → set visibility to **Public** so TrueNAS can pull without a login.

---

## TrueNAS: Install via YAML (recommended)

This is the Apps “config” path: **Discover Apps → ⋮ next to Custom App → Install via YAML**.

### 1. Prepare dataset folders

```bash
mkdir -p /mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset/{data,pgdata}
```

Copy `full_dataset.csv.gz` into `data/` (SMB/SFTP from your Mac).

### 2. Paste compose

1. Apps → Discover Apps  
2. Click **⋮** beside **Custom App** → **Install via YAML**  
3. Application name: `freshlens-bff`  
4. Paste contents of [`truenas-compose.yaml`](truenas-compose.yaml)  
5. Edit the two `/mnt/SwimmingPool/...` volume paths if your pool/dataset differs  
6. Save / Deploy  

TrueNAS pulls `postgres:16-alpine` and `ghcr.io/latsalmonman/freshlens-bff:latest` — **no build on the NAS**.

### 3. Check API

From a browser on home Wi‑Fi:

```
http://<NAS-LAN-IP>:3080/health
```

### 4. Import the CSV (one time)

TrueNAS YAML stacks don’t run Compose profiles well. Import from **SSH** (or Shell):

```bash
# Find the compose project network (name varies slightly)
docker network ls | grep -i freshlens

# Import (use the network name from the previous line; often ends in _default)
docker run --rm \
  --network ix-freshlens-bff_default \
  -v /mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset/data:/data:ro \
  -e DATABASE_URL=postgres://freshlens:freshlens@db:5432/recipes \
  ghcr.io/latsalmonman/freshlens-bff:latest \
  node src/importCsv.js --truncate --file /data/full_dataset.csv.gz
```

If `--network` can’t resolve `db`, list containers and use the DB container’s network:

```bash
docker ps --format '{{.Names}}' | grep -i freshlens
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' <db-container-name>
```

Smoke test first:

```bash
docker run --rm \
  --network ix-freshlens-bff_default \
  -v /mnt/SwimmingPool/lstsalmonman/FreshLens-Recipe-Dataset/data:/data:ro \
  -e DATABASE_URL=postgres://freshlens:freshlens@db:5432/recipes \
  ghcr.io/latsalmonman/freshlens-bff:latest \
  node src/importCsv.js --limit 50000 --file /data/full_dataset.csv.gz
```

Then:

```
http://<NAS-LAN-IP>:3080/health?exact=1
```

### 5. Point FreshLens

```bash
EXPO_PUBLIC_RECIPE_API_URL=http://<NAS-LAN-IP>:3080
```

---

## TrueNAS: Custom App form (single container)

The **Custom App** button (form UI) is awkward for **API + Postgres**. Prefer **Install via YAML** above.

If you only need the API container against an existing Postgres elsewhere, use Custom App with:

- Image: `ghcr.io/latsalmonman/freshlens-bff:latest`
- Port: `3080:3080`
- Env: `DATABASE_URL=postgres://...`

---

## Local docker-compose (dev)

[`docker-compose.yml`](docker-compose.yml) still supports `build: .` and an `importer` profile. Copy `.env.example` → `.env` and adjust host paths.

```bash
docker compose up -d --build
docker compose --profile import run --rm importer -- --limit 1000 --file /data/full_dataset.csv
```

---

## Notes

- No recipe images in this dataset (title-only cards)
- Private / prototype use of RecipeNLG-style scrapes
- Prefer ≥8 GB free RAM and ~25 GB disk for a full 2.2M import
