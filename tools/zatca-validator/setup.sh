#!/usr/bin/env bash
# تنزيل أداة التحقق الرسمية من الهيئة (ZATCA E-Invoicing SDK عبر zatca-cli) مع Java 11
# الاستخدام: bash tools/zatca-validator/setup.sh  ثم  export ZATCA_CLI=$PWD/tools/zatca-validator/zatca.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_VERSION=2.10.0
cd "$DIR"
if [ ! -d "zatca-cli-$CLI_VERSION" ]; then
  curl -fsSL -o cli.zip "https://github.com/lavaloon-eg/zatca-cli/releases/download/$CLI_VERSION/zatca-cli-$CLI_VERSION.zip"
  unzip -q cli.zip && rm cli.zip
fi
if [ ! -d jre ]; then
  # Java 11 مطلوب: الإصدارات الأحدث أزالت دعم منحنى secp256k1 المستخدم في توقيع الهيئة
  curl -fsSL -o jre.tgz "https://github.com/adoptium/temurin11-binaries/releases/download/jdk-11.0.23%2B9/OpenJDK11U-jre_x64_linux_hotspot_11.0.23_9.tar.gz"
  mkdir jre && tar xzf jre.tgz -C jre --strip-components=1 && rm jre.tgz
fi
echo "جاهز: export ZATCA_CLI=$DIR/zatca.sh"
