# Production Voronka

Production работает в отдельном каталоге `/opt/voronka`. Код находится в `/opt/voronka/app`, настройки — в `/opt/voronka/config`, резервные копии — в `/opt/voronka/backups`, служебные журналы — в `/opt/voronka/logs`. Значения из файлов настроек нельзя копировать в Git или сообщения.

## Обновление

После успешного CI подключитесь к production-серверу и выполните:

```bash
sudo /opt/voronka/app/scripts/deploy-production.sh
```

Скрипт принимает только fast-forward `main`, не изменяет production-настройки и PostgreSQL volume, делает проверяемый backup при появлении новых миграций, пересобирает только Voronka runtime и ждёт успешные health checks.

## Проверка и логи

```bash
cd /opt/voronka
docker compose ps
curl -fsS http://127.0.0.1:8081/health/live
curl -fsS http://127.0.0.1:8081/health/ready
docker compose logs --tail=100 --no-color runtime
ls -lt /opt/voronka/backups | head
```

Публичные `/health/live` и `/health/ready` также должны отвечать через настроенный HTTPS hostname.

## Если обновление не удалось

Старый контейнер продолжает работать, если ошибка произошла на сборке. Изучите последние runtime-логи. Для отката кода выполните в `/opt/voronka/app` `git merge-base --is-ancestor <предыдущий-commit> HEAD`, затем переключитесь на точно известный предыдущий commit, пересоберите только `runtime` и снова проверьте health. Не удаляйте volume PostgreSQL.

Восстановление БД требуется только при подтверждённой проблеме миграции: сначала сохраните отдельную копию текущего повреждённого состояния, остановите только Voronka runtime и восстановите проверенный `.dump` из `/opt/voronka/backups`. Остальные боты и их сервисы не трогайте.
