# Runs natural.mjs in a Playwright Linux container with a CPU quota, so the late frame comes from the machine itself.
#   podman volume create zag-repro-work
#   podman run --rm -v "$PWD":/src:ro -v zag-repro-work:/work mcr.microsoft.com/playwright:v1.63.0-noble bash /src/container.sh install
#   podman run --rm --cpus=0.1 --ipc=host -v "$PWD":/src:ro -v zag-repro-work:/work mcr.microsoft.com/playwright:v1.63.0-noble bash /src/container.sh run
# Install runs at full speed into the volume; only the run is throttled.
set -e
case "$1" in
  install)
    cd /src && tar --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C /work
    cd /work && (corepack enable || npm i -g pnpm) >/dev/null 2>&1
    pnpm install --frozen-lockfile --config.confirmModulesPurge=false ;;
  run)
    cd /work && cp /src/natural.mjs . && (corepack enable || npm i -g pnpm) >/dev/null 2>&1
    pnpm exec vite --port 5173 --strictPort > /tmp/vite.log 2>&1 &
    for i in $(seq 1 240); do curl -sf http://localhost:5173/ >/dev/null && break; sleep 0.5; done
    curl -s http://localhost:5173/src/App.tsx >/dev/null || true   # let vite prebundle deps before timing matters
    echo "cpu.max=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null)"
    ROUNDS="${ROUNDS:-10}" BROWSER="${BROWSER:-webkit}" node natural.mjs ;;
  *) echo "usage: container.sh install|run"; exit 2 ;;
esac
