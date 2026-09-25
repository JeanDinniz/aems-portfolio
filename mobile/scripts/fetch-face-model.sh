#!/usr/bin/env bash
# Baixa o modelo de reconhecimento facial usado pelo Ponto para assets/models/.
#
# MobileFaceNet (InsightFace, ~5MB): entrada 112x112 RGB, normalização
# (x-127.5)/128. Fonte: repo syaringan357/Android-MobileFaceNet-MTCNN-FaceAntiSpoofing
# (licença MIT). O arquivo é gitignored (não versionado); rode este script após
# clonar / antes de buildar. O contrato (112 + std 128) está fixado em
# src/services/face/preprocess.ts — se trocar de modelo, revise-o.
#
# Uso: npm run fetch:face-model   (ou: bash scripts/fetch-face-model.sh)
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/assets/models"
DEST="$DIR/mobilefacenet.tflite"
URL="https://raw.githubusercontent.com/syaringan357/Android-MobileFaceNet-MTCNN-FaceAntiSpoofing/master/app/src/main/assets/MobileFaceNet.tflite"

mkdir -p "$DIR"

if [ -f "$DEST" ]; then
  echo "Modelo já existe em $DEST — pulando download."
  exit 0
fi

echo "Baixando modelo facial MobileFaceNet (~5MB)..."
curl -fSL -o "$DEST" "$URL"

# Valida o cabeçalho TFLite (identificador 'TFL3' no offset 4 do FlatBuffer).
if ! head -c 8 "$DEST" | grep -q "TFL3"; then
  echo "ERRO: download inválido (não é um .tflite). Removendo." >&2
  rm -f "$DEST"
  exit 1
fi

echo "OK: $DEST"
