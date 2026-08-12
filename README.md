# FreshLens BFF — TrueNAS recipe API

Repo: [https://github.com/LatSalmonMan/FreshLensBFF](https://github.com/LatSalmonMan/FreshLensBFF)

Backend-for-frontend recipe search for FreshLens.
Postgres + Express on port **3080**. Image: **`ghcr.io/latsalmonman/freshlens-bff`**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Fast estimate; `?exact=1` for exact count (no API key) |
| GET/POST | `/recipes/search` | `?ingredients=chicken,rice` |
| GET | `/recipes/:id` | e.g. `r0` |
| GET | `/products/:code` | Local Open Food Facts barcode lookup |
| POST | `/products` | Cache a product after a live OFF miss |

When `FRESHLENS_API_KEY` (or `API_KEY`) is set on the server, recipe/product routes require header `X-FreshLens-Key`. See **[SHARE.md](SHARE.md)** for Cloudflare / DuckDNS / TestFlight without buying a domain.

---

## Publish (GitHub Actions)

Pushes to `main` build and publish:

`ghcr.io/latsalmonman/freshlens-bff:latest`

Package: [ghcr.io/latsalmonman/freshlens-bff](https://github.com/LatSalmonMan/FreshLensBFF/pkgs/container/freshlens-bff)

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
4. Paste from [truenas-compose.yaml (raw)](https://raw.githubusercontent.com/LatSalmonMan/FreshLensBFF/main/truenas-compose.yaml) — or open the [repo file](https://github.com/LatSalmonMan/FreshLensBFF/blob/main/truenas-compose.yaml)  
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

### 4b. Import Open Food Facts (instant barcode scans)

Same **app shell** as the recipe import (not the TrueNAS system shell):

```bash
node src/importOff.js --download --truncate
```

That downloads the ~0.9 GB dump into `/data` and loads US/world products. Takes a while. When it finishes:

```
http://<NAS-LAN-IP>:10100/health?exact=1
```

`products` should be hundreds of thousands, not 0.

Re-run later with `--truncate --download` to refresh. Use `--all-countries` if you want the full global dump.

### 5. Point FreshLens

```bash
EXPO_PUBLIC_RECIPE_API_URL=http://<NAS-LAN-IP>:10100
# Optional — only if FRESHLENS_API_KEY is set on the BFF:
# EXPO_PUBLIC_RECIPE_API_KEY=same-secret-as-server
```

To share Find recipes with people off your Wi‑Fi (Cloudflare tunnel, DuckDNS, API key, TestFlight), follow **[SHARE.md](SHARE.md)**. Keep the NAS BFF + Postgres running when they use recipes.

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
