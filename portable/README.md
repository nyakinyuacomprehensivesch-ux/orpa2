# Orpa — Portable Deployment Guide

Run Orpa on **any x86 machine** — no Node.js install, no cloud account, no config.
Just copy, run, and open a browser.

---

## 🚀 Three Portable Options

| # | Method | Best For | Size | Needs Node.js? | Needs Docker? |
|---|--------|----------|------|----------------|----------------|
| 1 | **Single Binary** | USB stick, offline PC, quick demo | ~50 MB | No (baked in) | No |
| 2 | **Docker** | Server/VM, always-on, team sharing | ~120 MB image | No | Yes |
| 3 | **Windows .exe** | School PC (Windows), USB stick | ~50 MB | No (baked in) | No |

---

## Option 1 — Single Binary (Linux x86_64)

> Zero install. Copy one file. Run.

### On a machine WITH Node.js (build machine)

```bash
cd linux
chmod +x build.sh
./build.sh
```

This produces `linux/dist/orpa-server` — a single standalone binary.

### On the TARGET machine (no Node.js needed)

1. Copy the entire `dist/` folder to the target PC:
   ```bash
   scp -r linux/dist/ user@target-pc:~/orpa/
   ```
2. (Optional) Copy `.env.example` to `.env` and set your secrets.
3. Run:
   ```bash
   cd ~/orpa
   chmod +x orpa-server
   ./start.sh
   ```
4. Open **http://localhost:8000** in a browser.

### Make it accessible on the local network

Edit `.env` or run with environment override:
```bash
PORT=0.0.0.0:8000 ./orpa-server
```
Then other devices on the same WiFi/LAN open `http://<your-ip>:8000`.

---

## Option 2 — Docker (Linux x86_64)

> Best for always-on servers, VMs, or shared school networks.

### Prerequisite: Docker installed

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install docker.io docker-compose-v2
sudo usermod -aG docker $USER
# Log out and back in
```

### Build & Run

```bash
cd linux-full
chmod +x build-docker.sh run-docker.sh

# Build the image
./build-docker.sh

# Start the container (runs in background)
./run-docker.sh
```

Open **http://localhost:8000** — done.

### Or use Docker Compose (includes PostgreSQL)

```bash
cd linux-full

# Uncomment the `db` service in docker-compose.yml first,
# then:
docker compose up -d
```

### Stop
```bash
# Docker approach
./run-docker.sh  # then Ctrl+C, or:
docker stop orpa

# Compose approach
docker compose down
```

### Data persists!
- JSON store: Docker volume `orpa-data` → `/app/data`
- PostgreSQL: Docker volume `orpa-pgdata`
- Survives container restarts and updates.

---

## Option 3 — Windows Portable (.exe)

> For school Windows PCs. No admin rights needed.

### On a machine WITH Node.js (build machine)

```cmd
cd windows
build-windows.bat
```

This produces `windows/dist/orpa-server.exe`.

### On the TARGET Windows PC (no Node.js needed)

1. Copy the entire `dist/` folder to the target PC (USB stick works).
2. (Optional) Copy `.env.example` to `.env` and edit.
3. Double-click **`start.bat`** — or open CMD and run:
   ```cmd
   orpa-server.exe
   ```
4. Open **http://localhost:8000** in a browser.

### Windows Firewall

If other devices need access, Windows Firewall may block incoming connections.
When the prompt appears, click **"Allow access"** for private networks.

---

## ⚙️ Configuration (all methods)

Copy `.env.example` to `.env` and edit:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8000` | Server port |
| `JWT_SECRET` | *(random)* | Token signing — **set in production** |
| `OWNER_EMAIL` | `owner@orpa.local` | Super-admin email |
| `OWNER_PASSWORD` | `changeme123` | Super-admin password — **change this** |
| `DATABASE_URL` | *(blank)* | PostgreSQL connection string |
| `EMAIL_SMTP_*` | *(blank)* | Real email delivery |

> Without `DATABASE_URL`, the app uses a local JSON file (fine for pilots).
> Without SMTP settings, emails are saved to `data/emails/` instead of sent.

---

## 🔐 Making It Safe for Public/Network Use

1. **Change the default owner password** before first run.
2. **Set a strong `JWT_SECRET`** — generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. **Run behind HTTPS** if exposed beyond localhost. Options:
   - Use a reverse proxy (Caddy/Nginx) with auto-TLS
   - Use the Render/cloud deployment from the main repo
   - For LAN-only, HTTP is acceptable but not ideal
4. **Rate limiting** is built in (20 login attempts / 15 min per IP).

---

## 📋 Quick Comparison

```
USB stick demo ────► Option 1 (single binary)
School server ─────► Option 2 (Docker)
Windows classroom ─► Option 3 (.exe)
Internet sharing ──► Use Render deployment (main repo)
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| "Permission denied" | `chmod +x orpa-server` or `chmod +x start.sh` |
| Port 8000 already in use | Change `PORT` in `.env` or `PORT=9000 ./start.sh` |
| Can't access from other devices | Bind to all interfaces: `PORT=0.0.0.0:8000` and check firewall |
| Docker: "Cannot connect to Docker daemon" | Start Docker: `sudo systemctl start docker` |
| Windows SmartScreen warning | Click "More info" → "Run anyway" (it's an unsigned exe) |
| Data lost after Docker restart | Make sure you're using a named volume, not a bind mount |
