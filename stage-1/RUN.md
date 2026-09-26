# Pocketful — Stage 1

Node.js, zero external dependencies. Build and run:

```sh
docker build -t pocketful-stage-1 .
docker run --rm -p 8080:8080 -e PORT=8080 pocketful-stage-1
```

Then:

```sh
curl http://localhost:8080/health
```

returns `{"status":"ok"}` once the service is ready (immediately — the store is in-memory).

## Notes

- All state is in-memory and process-local; it does not persist across restarts, and `POST /_test/reset` / `POST /_test/import` fully replace it.
- No outbound network is required or used at runtime.
- `GET /_test/export`, `POST /_test/import`, `POST /_test/reset`, `GET /health`, `POST /auth/signup` and `POST /auth/login` are the only unauthenticated endpoints; every other endpoint requires `Authorization: Bearer <token>`.
