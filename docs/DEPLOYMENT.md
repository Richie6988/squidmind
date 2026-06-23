# IAQUA Deployment Guide

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Set to `production` to disable debug overhead |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `LOG_FORMAT` | `pretty` | `json` for log aggregators (ELK, Datadog, Loki) |
| `IAQUA_CORS_ORIGIN` | `http://localhost:3000` | Comma-separated list, or `*` for any (not recommended) |
| `IAQUA_API_TOKEN` | unset | If set, all non-GET routes require `Authorization: Bearer <token>` (localhost bypasses for dev) |
| `HUGGINGFACE_API_KEY` | unset | For higher HF Inference quotas |
| `TELEGRAM_BOT_TOKEN` | unset | Telegram bot integration (also configurable via UI) |

## Health Endpoints

- `GET /api/v2/livez` — process alive (no IO, cheap, use for k8s liveness probe)
- `GET /api/v2/readyz` — server can serve traffic (registry readable, use for k8s readiness probe)
- `GET /api/v2/health` — full status with `up`/`degraded`/`down` + 503 on full failure

Example load balancer config (HAProxy):
```
option httpchk GET /api/v2/livez
http-check expect status 200
```

## Docker Deployment

```bash
# Build
docker build -t iaqua:latest .

# Run with persistent state
docker run -d \
  --name iaqua \
  -p 3000:3000 \
  -v $(pwd)/aquarium:/app/aquarium \
  -v $(pwd)/models:/app/aquarium/MODELS \
  -e LOG_LEVEL=INFO \
  -e LOG_FORMAT=json \
  -e IAQUA_API_TOKEN=$(openssl rand -hex 32) \
  --restart unless-stopped \
  iaqua:latest

# Logs
docker logs -f iaqua

# Health
curl http://localhost:3000/api/v2/health
```

## Backups & Recovery

Automatic snapshots are stored in `aquarium/.backups/`:
- `hourly/` — last 24 snapshots (1 per hour)
- `daily/` — last 7 snapshots (1 per day, after 24h)

Snapshotted files:
- `BRAIN/soul.json`, `poseidon_brain.json`, `dream_memory.json`
- `AGENTS/agent_registry.json`
- `PROJECTS/project_registry.json`
- `TASKS/tasks_registry.json`, `results_log.json`
- `MODELS/model_registry.json`
- `SKILLS/skills_registry.json`

### Manual snapshot
```bash
curl -X POST http://localhost:3000/api/v2/backups/snapshot \
  -H "Content-Type: application/json" \
  -d '{"bucket":"daily"}'
```

### List snapshots
```bash
curl http://localhost:3000/api/v2/backups
```

### Recovery
1. Stop the server (`SIGTERM`)
2. Copy the desired snapshot back:
   ```bash
   cp -r aquarium/.backups/hourly/2026-06-22T14-00-00-000Z/BRAIN/* aquarium/BRAIN/
   ```
3. Restart

## Graceful Shutdown

Server handles `SIGINT` and `SIGTERM`:
1. Stop accepting new HTTP connections
2. Stop heartbeat (no new dream/audit triggers)
3. Stop bot polling
4. Persist `_done.json` (in-flight task tracking)
5. Flush pending registry writes
6. Take final backup snapshot
7. Unload all GGUF models (frees VRAM)
8. Exit cleanly within 15s (hard timeout)

Second signal forces immediate exit.

## Monitoring

### Logs (JSON format example)
```json
{"ts":"2026-06-22T14:00:00.000Z","level":"WARN","scope":"TaskRunner","msg":"Task task_0042 retry 2/3"}
```

### Metrics scraping
`GET /api/v2/health` returns:
```json
{
  "status": "up",
  "uptime_seconds": 3600,
  "response_time_ms": 12,
  "checks": { "main/poseidon_brain.json": "ok", ... },
  "optional": {
    "poseidon_model": "configured",
    "model_loaded": "yes",
    "broker_state": "IDLE"
  }
}
```

## Tests

```bash
npm run test:smoke         # Server boots + endpoints respond
npm run test:integration   # Task lifecycle + cascade + race-safety
npm test                   # Both
```

## Security Posture

For internet exposure:
1. Set `IAQUA_API_TOKEN` to a strong random value
2. Set `IAQUA_CORS_ORIGIN` to your exact frontend domain
3. Run behind a reverse proxy (nginx, Caddy) with TLS
4. Mount `aquarium/` read-only volumes where possible
5. Use Docker user namespace remapping
6. Monitor `aquarium/.backups/` disk usage (snapshots can grow)
