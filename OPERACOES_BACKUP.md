# Operações de Backup e Restore — AEMS

> Criado a partir dos achados CRÍTICO-1 e CRÍTICO-2 da auditoria técnica
> (`docs/auditoria/AUDITORIA_2026-07.md`). Cobre produção; HML tem apenas o
> dump pré-deploy.

## O que roda automaticamente

| O quê | Quando | Onde fica | Retenção |
|-------|--------|-----------|----------|
| `pg_dump` do Postgres (serviço `db_backup`) | Diário ~03:00 (e no boot do container, se ainda não houver o do dia) | `/var/www/aems/backups/postgres/daily/` | 7 diários |
| Cópia semanal (domingo) | Domingo ~03:00 | `/var/www/aems/backups/postgres/weekly/` | 4 semanais |
| Espelho das fotos do MinIO (serviço `minio_backup`) | Diário (incremental — fotos são imutáveis) | `/var/www/aems/backups/minio/` | Espelho 1:1, sem expiração |
| Dump pré-deploy | A cada deploy (prod **e** HML), antes das migrations | `backups/pre_deploy/` | 5 últimos |

O deploy **aborta** se o dump pré-deploy falhar (proposital: sem rede de
segurança, não se mexe no banco).

## Rollback automático no deploy

Após subir a nova imagem e rodar as migrations, o deploy espera a API ficar
`healthy` (até 90s). Se não ficar:

1. A imagem **anterior** (tag local `aems-api:rollback`, criada no início do
   deploy) é subida de volta automaticamente.
2. O job do GitHub Actions falha (exit 1) para sinalizar.
3. **Migrations não são revertidas automaticamente** — se a migration for a
   causa da falha, restaure o dump pré-deploy (abaixo). Migrations aditivas
   (colunas/tabelas novas) geralmente convivem bem com o código antigo.

## Como restaurar

### Postgres (banco inteiro)

```bash
cd /var/www/aems

# 1. Parar quem escreve no banco
docker compose -f docker-compose.prod.yml stop api celery_worker celery_beat

# 2. Restaurar (escolha o dump)
gunzip -c backups/postgres/daily/aems_YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Para restaurar em banco limpo (recomendado em desastre):
# docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
# ... e então o gunzip acima.

# 3. Subir de volta
docker compose -f docker-compose.prod.yml up -d api celery_worker celery_beat
```

### Fotos (MinIO)

```bash
# Espelho reverso: do backup para o bucket
docker run --rm --network aems_default \
  -v /var/www/aems/backups/minio:/restore \
  --env-file /var/www/aems/.env.production \
  minio/mc sh -c 'mc alias set dst http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mirror --overwrite /restore dst/aems-files'
```

## Como verificar que o backup está saudável

```bash
ls -lh /var/www/aems/backups/postgres/daily/    # deve ter arquivo de hoje/ontem
docker logs aems_db_backup --tail 5             # "[db_backup] concluído: ..."
docker logs aems_minio_backup --tail 5
```

Teste de restore (fazer ao menos 1×/trimestre): restaurar o dump mais recente
num banco descartável e conferir contagens básicas:

```bash
gunzip -c backups/postgres/daily/aems_YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'createdb -U "$POSTGRES_USER" restore_test && psql -U "$POSTGRES_USER" -d restore_test' \
  && docker compose -f docker-compose.prod.yml exec -T postgres \
     sh -c 'psql -U "$POSTGRES_USER" -d restore_test -c "SELECT COUNT(*) FROM service_orders;" && dropdb -U "$POSTGRES_USER" restore_test'
```

## Acesso a mídia (fotos em /uploads)

Desde 2026-07 as fotos NÃO são mais públicas (ALTO-2 da auditoria). O Nginx
valida cada request de `/uploads/` via `auth_request` → `GET /upload/media-auth`,
que aceita:

- **Web:** cookie httpOnly `aems_media` (emitido no login/refresh, apagado no
  logout). `<img>` envia o cookie automaticamente — nenhuma URL de foto mudou.
- **Mobile:** header `Authorization: Bearer <access_token>` nas `<Image>`.

**Pendência do app mobile:** as `<Image>` que carregam fotos de `/uploads`
precisam passar a enviar o header `Authorization` (via `source={{ uri, headers }}`
do React Native). Sem isso, as fotos aparecem quebradas no app. Momento seguro
para tratar: o app ainda não foi submetido às lojas. Rastreado no repositório
mobile.

**Dev local:** sem Nginx (a API serve `/uploads` via StaticFiles), as fotos
seguem abertas em `localhost` — o controle só existe atrás do Nginx (HML/prod).

**Bucket MinIO** mantém policy de leitura pública **interna** (necessária para o
proxy do Nginx), mas a porta 9000 não é exposta à internet — o único caminho
externo até as fotos é o `/uploads/` do Nginx, agora autenticado.

## Pendência conhecida (registrada de propósito)

**Não há cópia off-site.** Os backups vivem no disco do próprio VPS — protegem
contra migration ruim, deleção acidental e corrupção, mas **não** contra perda
do droplet. Próxima etapa recomendada: espelhar `backups/` para um DigitalOcean
Spaces (o sidecar `minio/mc` já fala S3 — basta um segundo `mc mirror` com as
credenciais do Space no `.env.production`).
