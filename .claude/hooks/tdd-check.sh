#!/bin/bash
# Hook: verifica se commits de codigo de producao incluem testes (.spec.ts)
# Usado como PreToolUse hook no settings.json do Claude Code

input=$(cat)
# jq nem sempre existe no Git Bash do Windows; sem ele o hook viraria no-op
# silencioso. Node esta sempre disponivel neste repo, entao serve de fallback.
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
else
  cmd=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).tool_input?.command||"")}catch{}})')
fi

# So verificar em comandos git commit
if echo "$cmd" | grep -qE '^git commit'; then
  specs=$(git diff --cached --name-only | grep -cE '\.spec\.ts$' || true)
  sources=$(git diff --cached --name-only | grep -E '\.(service|repository|provider)\.ts$' | grep -vcE '\.spec\.ts$' || true)

  if [ "$sources" -gt 0 ] && [ "$specs" -eq 0 ]; then
    echo 'ALERTA TDD: Voce esta commitando codigo de producao (service/repository/provider) sem nenhum arquivo .spec.ts. Siga o ciclo Red-Green-Refactor e inclua os testes.' >&2
    exit 2
  fi
fi

exit 0
