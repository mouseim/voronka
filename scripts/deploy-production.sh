#!/bin/sh
set -eu

VORONKA_ROOT=${VORONKA_ROOT:-/opt/voronka}
APP_DIR="$VORONKA_ROOT/app"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[ -d "$APP_DIR/.git" ] || fail "Не найден production checkout: $APP_DIR"
[ -f "$VORONKA_ROOT/compose.yml" ] || fail "Не найден compose.yml"
cd "$APP_DIR"
[ "$(git branch --show-current)" = main ] || fail "Production checkout должен быть на main"
[ -z "$(git status --porcelain)" ] || fail "В production checkout есть локальные изменения"

previous_commit=$(git rev-parse HEAD)
git fetch --prune origin main
target_commit=$(git rev-parse origin/main)
pending_migrations=$(git diff --name-only "$previous_commit" "$target_commit" -- telegram-bot.local/migrations)

if [ -n "$pending_migrations" ]; then
  cd "$VORONKA_ROOT"
  mkdir -p backups
  chmod 700 backups
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup="$VORONKA_ROOT/backups/pre-deploy-$stamp.dump"
  docker compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup"
  [ -s "$backup" ] || fail "Резервная копия PostgreSQL пуста"
  sha256sum "$backup" > "$backup.sha256"
  docker compose exec -T postgres sh -c 'pg_restore -l' < "$backup" >/dev/null
  printf 'PostgreSQL backup: %s\n' "$backup"
  cd "$APP_DIR"
fi

if [ "$previous_commit" != "$target_commit" ]; then
  git merge --ff-only origin/main
else
  printf 'Код уже актуален: %s\n' "$target_commit"
fi

cd "$VORONKA_ROOT"
docker compose build runtime
docker compose up -d --no-deps runtime

attempt=0
while [ "$attempt" -lt 24 ]; do
  state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' voronka-runtime-1 2>/dev/null || true)
  [ "$state" = healthy ] && break
  attempt=$((attempt + 1))
  sleep 5
done
[ "${state:-missing}" = healthy ] || {
  docker compose logs --tail=80 --no-color runtime >&2
  fail "Runtime не стал healthy"
}

curl -fsS http://127.0.0.1:8081/health/live >/dev/null
curl -fsS http://127.0.0.1:8081/health/ready >/dev/null
expected_migrations=$(find "$APP_DIR/telegram-bot.local/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')
applied_migrations=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM schema_migrations"' | tr -d '[:space:]')
[ "$expected_migrations" = "$applied_migrations" ] || fail "Применены не все миграции"

printf 'Voronka runtime updated: %s -> %s\n' "$previous_commit" "$target_commit"
printf 'Health: live PASS, ready PASS; migrations: %s/%s\n' "$applied_migrations" "$expected_migrations"
