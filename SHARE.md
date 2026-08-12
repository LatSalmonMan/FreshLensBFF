# Share FreshLens (no paid domain)

Scan, produce, kitchen, and favorites already work anywhere — those live on the phone + Open Food Facts / Gemini.  
**Find recipes** needs your TrueNAS BFF reachable from the internet. This guide covers that without buying a domain.

You can keep using LAN forever. Public tunnel + API key are **optional** until parents need Find recipes off your Wi‑Fi.

---

## 1. Apple Developer (when you invite parents)

TestFlight needs the **paid** Apple Developer Program (~$99/year).

1. Enroll: https://developer.apple.com/programs  
2. Wait for approval email  
3. Xcode → Settings → Accounts → download certificates  
4. Later: EAS or Xcode Archive → upload → TestFlight invite by email  

Until then, only devices you plug into your Mac can run Debug/Release builds.

---

## 2. Optional API key (recommended before any public tunnel)

### On TrueNAS (BFF Custom App env)

```
FRESHLENS_API_KEY=pick-a-long-random-string
```

(Or `API_KEY=…` — same effect.)

- **Unset** → API stays open on your LAN (current behavior)  
- **Set** → `/recipes/*` and `/products/*` require header `X-FreshLens-Key: …`  
- `/health` stays open (no key) for uptime checks  

Restart the BFF app after adding the env var. Pull the latest `ghcr.io/latsalmonman/freshlens-bff:latest` so `src/auth.js` is included.

### On the phone (FreshLens `.env`)

```
EXPO_PUBLIC_RECIPE_API_URL=http://192.168.86.66:10100
EXPO_PUBLIC_RECIPE_API_KEY=pick-a-long-random-string
```

Use the **same** string as `FRESHLENS_API_KEY`. Rebuild the app after changing `EXPO_PUBLIC_*` (Release embeds env at build time).

For home-only LAN you can leave `EXPO_PUBLIC_RECIPE_API_KEY` blank **and** leave `FRESHLENS_API_KEY` unset.

---

## 3. Cloudflare tunnel without buying a domain

### A. Quick tunnel on TrueNAS (Mac can sleep)

URL **changes every time the cloudflared app restarts** — fine for family testing if you update the app URL after a restart. Not ideal long-term.

**TrueNAS → Discover Apps → Custom App** (one container):

| Field | Value |
|--------|--------|
| Image repository | `cloudflare/cloudflared` |
| Image tag | `latest` |
| Entrypoint | leave default / `cloudflared` |
| Command / args | `tunnel --url http://192.168.86.66:10100` |
| Network | Host networking **or** default (host IP above must reach the BFF port) |

Use your real NAS LAN IP if it isn’t `192.168.86.66`. Port is whatever you mapped for the BFF (often `10100` → container `3080`).

1. Deploy the app  
2. Open **Logs** for that app  
3. Copy the line `https://….trycloudflare.com`  
4. Put that in FreshLens `.env` as `EXPO_PUBLIC_RECIPE_API_URL`  
5. Set matching `EXPO_PUBLIC_RECIPE_API_KEY` / `FRESHLENS_API_KEY`  
6. Rebuild the phone app  

Leave the **cloudflared** Custom App running. You can close your Mac.

From a Mac (optional one-shot test):

```bash
cloudflared tunnel --url http://192.168.86.66:10100
```

### B. Stable free hostname (DuckDNS + Cloudflare named tunnel)

Best path for parents without paying for a domain.

1. Create a free [DuckDNS](https://www.duckdns.org) subdomain, e.g. `freshlens-recipes.duckdns.org`  
2. Create a free [Cloudflare](https://dash.cloudflare.com) account  
3. Add the DuckDNS hostname to Cloudflare (follow DuckDNS “how to use with Cloudflare” / CNAME to Cloudflare if you use their NS, **or** create a Cloudflare Tunnel and point DuckDNS at the tunnel target Cloudflare gives you)  
4. Install **cloudflared** on TrueNAS as a Custom App:
   - Image: `cloudflare/cloudflared:latest`  
   - Command / args: `tunnel --no-autoupdate run`  
   - Env: `TUNNEL_TOKEN=<token from Cloudflare Zero Trust → Networks → Tunnels → Create>`  
5. In the Cloudflare tunnel config, public hostname → service `http://192.168.86.66:10100` (or the BFF container hostname on the Docker network)  
6. Set on TrueNAS BFF: `FRESHLENS_API_KEY=…`  
7. Set in FreshLens `.env`:
   ```
   EXPO_PUBLIC_RECIPE_API_URL=https://freshlens-recipes.duckdns.org
   EXPO_PUBLIC_RECIPE_API_KEY=…
   ```
8. Rebuild Release / TestFlight  

**Do not** tunnel Postgres (`5432`) or the TrueNAS UI — only the recipe API port.

---

## 4. Keep the NAS on

If TrueNAS sleeps or the BFF/Postgres apps stop:

- Find recipes fails for everyone off-LAN  
- Scan / produce / kitchen checklist still work  

Leave **Postgres + FreshLens BFF** (and `cloudflared` if used) running whenever parents might cook.

---

## 5. TestFlight (after Apple + stable HTTPS)

1. Confirm `https://your-hostname/health` works from cellular  
2. Confirm Find recipes works on a phone **not** on home Wi‑Fi  
3. Archive / EAS build with the HTTPS URL + API key baked in  
4. Upload to App Store Connect → TestFlight → invite parents’ Apple IDs  

Their pantry, scans, and favorites stay **on their phone**. Your Gemini key still pays for their produce / ingredient photos.

---

## Checklist

- [ ] (Optional home) Keep `EXPO_PUBLIC_RECIPE_API_URL=http://192.168.86.66:10100`, no API key  
- [ ] (Before tunnel) Set matching `FRESHLENS_API_KEY` + `EXPO_PUBLIC_RECIPE_API_KEY`  
- [ ] Cloudflare account + DuckDNS (or quick tunnel for a one-night test)  
- [ ] TrueNAS BFF + Postgres (+ cloudflared) left running  
- [ ] Apple Developer enrolled  
- [ ] Off-LAN Find recipes smoke test  
- [ ] TestFlight invite  
