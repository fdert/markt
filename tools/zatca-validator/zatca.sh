#!/usr/bin/env bash
# تشغيل أداة الهيئة: zatca.sh validate -c cert.pem -p <PIH> invoice.xml
#                    zatca.sh sign -c cert.pem -k key.b64 -o out.xml invoice.xml
DIR="$(cd "$(dirname "$0")" && pwd)"
export JAVA_HOME="$DIR/jre" PATH="$DIR/jre/bin:$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8
export JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8"   # بدونها تتحول الحروف العربية إلى ؟ وتفسد البصمة
B="$DIR/zatca-cli-2.10.0"
cmd=$1; shift
exec "$B/bin/zatca-cli" "$cmd" -b "$B" "$@" 2>/dev/null
