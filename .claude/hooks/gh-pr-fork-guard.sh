#!/bin/bash
# Hook: bloqueia gh pr <mutating> que nao aponte para marcelofrbr/robo-multipost
# Motivo: este clone e um fork (marcelofrbr) de maiconramos/robo-multipost, que
# por sua vez e fork de gitroomhq/postiz-app. Sem --repo, gh CLI resolve PRs
# contra o repositorio pai — PRs internos acabaram expostos no Postiz publico
# (PR #1509 em gitroomhq/postiz-app) e, depois, fechados como spam pelo
# workflow "PR Quality" do maiconramos (PR #45). Regra: PR SEMPRE no nosso
# proprio repositorio, nunca no maiconramos nem no gitroomhq.

input=$(cat)
# jq nem sempre existe no Git Bash do Windows; sem ele o hook viraria no-op
# silencioso. Node esta sempre disponivel neste repo, entao serve de fallback.
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
else
  cmd=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).tool_input?.command||"")}catch{}})')
fi

OUR_REPO='marcelofrbr/robo-multipost'

# So bloqueia comandos mutating de PR (create/edit/merge/close/ready/review/comment/reopen).
# Comandos read-only (view, list, diff, checks, status) continuam livres.
if echo "$cmd" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+(create|edit|merge|close|ready|review|comment|reopen)\b'; then
  if echo "$cmd" | grep -qE -- '--repo[[:space:]]+(maiconramos|gitroomhq)/'; then
    echo "BLOQUEADO: gh pr contra maiconramos/gitroomhq. PRs vao SEMPRE para $OUR_REPO." >&2
    exit 2
  fi
  if ! echo "$cmd" | grep -qE -- "--repo[[:space:]]+$OUR_REPO\b"; then
    echo "BLOQUEADO: gh pr <create|edit|merge|close|ready|review|comment|reopen> SEM --repo $OUR_REPO." >&2
    echo 'Este clone e fork; sem --repo, o comando vai contra o repositorio pai (maiconramos -> gitroomhq).' >&2
    echo "Reescreva: gh pr <subcomando> --repo $OUR_REPO --base main --head <branch> ..." >&2
    exit 2
  fi
fi

exit 0
