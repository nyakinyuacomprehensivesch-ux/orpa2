#!/usr/bin/env bash
# =============================================================
# Orpa — Build Portable Linux x86_64 Binary
# =============================================================
# This script uses Vercel's `pkg` to compile the entire
# Orpa server (Node + deps + frontend) into a single
# standalone executable. No Node.js installation needed
# on the target machine — just copy the binary and run.
#
# Prerequisites (on the BUILD machine):
#   - Node.js 18+ installed
#   - npm
#
# Usage:
#   chmod +x build.sh
#   ./build.sh
#
# Output:
#   orpa-server   (single ~50 MB binary, Linux x86_64)
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"  # the Orpa-Server repo
BUILD_DIR="$SCRIPT_DIR/build-tmp"
OUTPUT_DIR="$SCRIPT_DIR/dist"
BINARY_NAME="orpa-server"

echo ""
echo "========================================"
echo " Orpa Portable Builder (Linux x86_64)"
echo "========================================"
echo ""

# ---- 1. Prepare a clean build directory ----
rm -rf "$BUILD_DIR" "$OUTPUT_DIR"
mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"

# Copy source files
cp -r "$SOURCE_DIR/server.js" "$BUILD_DIR/"
cp -r "$SOURCE_DIR/lib" "$BUILD_DIR/"
cp -r "$SOURCE_DIR/public" "$BUILD_DIR/"
cp -r "$SOURCE_DIR/package.json" "$BUILD_DIR/"
cp -r "$SOURCE_DIR/package-lock.json" "$BUILD_DIR/" 2>/dev/null || true
cp -r "$SOURCE_DIR/.env.example" "$BUILD_DIR/"
cp -r "$SOURCE_DIR/render.yaml" "$BUILD_DIR/" 2>/dev/null || true
mkdir -p "$BUILD_DIR/data"

# ---- 2. Install production dependencies ----
echo "[1/4] Installing production dependencies..."
cd "$BUILD_DIR"
npm install --production --ignore-scripts 2>&1 | tail -1
echo ""

# ---- 3. Install pkg ----
echo "[2/4] Installing pkg compiler..."
npm install --no-save @vercel/pkg@5.8.1 2>&1 | tail -1
echo ""

# ---- 4. Compile into single binary ----
echo "[3/4] Compiling standalone binary (this takes a minute)..."
npx pkg server.js \
  --target node18-linux-x64 \
  --output "$BINARY_NAME" \
  --config package.json \
  --compress Brotli \
  2>&1 | tail -5
echo ""

# ---- 5. Package the distribution ----
echo "[4/4] Packaging distribution..."
mv "$BINARY_NAME" "$OUTPUT_DIR/"
cp "$SOURCE_DIR/.env.example" "$OUTPUT_DIR/"
mkdir -p "$OUTPUT_DIR/data"

# Create a convenience launcher script
cat > "$OUTPUT_DIR/start.sh" << 'LAUNCHER'
#!/usr/bin/env bash
# Orpa — Portable Launcher
# Edit .env before first run, or just run with defaults.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Load .env if present
if [ -f .env ]; then
  echo "[start] Loading .env configuration..."
  set -a
  source .env
  set +a
fi

echo "[start] Starting Orpa server..."
echo "[start] Open http://localhost:8000 in your browser"
echo "[start] Press Ctrl+C to stop"
echo ""
exec ./orpa-server
LAUNCHER
chmod +x "$OUTPUT_DIR/start.sh"

# Create a README for the dist
cat > "$OUTPUT_DIR/README.txt" << 'README'
===============================================
  Orpa Server — Portable Edition (Linux)
===============================================

No installation needed. Just:

  1. Copy this entire folder to the target PC.
  2. (Optional) Copy .env.example to .env and edit it.
  3. Run:  ./start.sh
         or:  ./orpa-server
  4. Open http://localhost:8000 in a browser.

Default owner account:
  Email:    owner@orpa.local
  Password: changeme123

!! Change these before first use !!
  Either set OWNER_EMAIL / OWNER_PASSWORD in .env
  or change the password from the app's Profile page.

For PostgreSQL support:
  Set DATABASE_URL in .env, e.g.:
  DATABASE_URL=postgres://user:pass@host:5432/orpa

To make it accessible from other devices on the
same network, set PORT and ensure the firewall
allows connections, e.g.:
  PORT=0.0.0.0:8000

Then other devices open:
  http://<this-pc-ip>:8000

README

# Clean up
rm -rf "$BUILD_DIR"

echo ""
echo "✅ Build complete!"
echo "   Output: $OUTPUT_DIR/"
echo "   Binary: $(du -h "$OUTPUT_DIR/$BINARY_NAME" | cut -f1)"
echo ""
echo "To run:  cd $OUTPUT_DIR && ./start.sh"
echo ""
