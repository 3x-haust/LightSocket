#!/usr/bin/env bash

echo "현재 버전: $(npm version --json | jq -r '."lightsocket"')"
echo "버전 선택 (엔터 없이 한 글자): [p]atch [m]inor [j]major [s]kip"

read -r -n 1 version_key
echo

case "$version_key" in
  p|P)
    version="patch"
    ;;
  m|M)
    version="minor"
    ;;
  j|J)
    version="major"
    ;;
  s|S)
    echo "버전 업데이트를 건너뜁니다."
    ;;
  *)
    echo "잘못된 입력입니다. p/m/j/s 중 하나를 누르세요."
    exit 1
    ;;
esac

if [[ "$version_key" != "s" && "$version_key" != "S" ]]; then
  npm version "$version"
fi

npm publish --access public