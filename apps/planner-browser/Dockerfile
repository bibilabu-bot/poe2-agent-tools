FROM node:22-alpine
WORKDIR /app
# Only project source and lock metadata; no game assets, credentials, DB or Electron.
COPY data/upstream-sources.lock.json data/upstream-sources.lock.json
COPY apps/planner-browser/server.cjs apps/planner-browser/server.cjs
COPY apps/planner-desktop/renderer/*.js apps/planner-desktop/renderer/
COPY apps/planner-desktop/renderer/*.css apps/planner-desktop/renderer/
COPY apps/planner-desktop/renderer/index.html apps/planner-desktop/renderer/index.html
COPY apps/planner-desktop/src/interop/*.js apps/planner-desktop/src/interop/
COPY apps/planner-desktop/src/interop/ggg-build-v1-contract.json apps/planner-desktop/src/interop/
COPY apps/planner-desktop/electron/runtime-resource-store.cjs apps/planner-desktop/electron/
COPY apps/planner-desktop/electron/wegame-import-service.cjs apps/planner-desktop/electron/
COPY apps/planner-desktop/data/cache/manifest.json apps/planner-desktop/data/cache/manifest.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "const u=new URL(process.env.PLANNER_ORIGIN||'http://127.0.0.1:8787'); fetch('http://127.0.0.1:8787/health',{headers:{host:u.host}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/planner-browser/server.cjs"]
