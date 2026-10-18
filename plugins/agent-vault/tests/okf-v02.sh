#!/usr/bin/env bash
set -euo pipefail

plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
fixtures="$plugin_root/tests/fixtures"
validator="$plugin_root/bin/okf-validate.rb"
upgrader="$plugin_root/bin/okf-upgrade-v0.2.rb"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expect_valid() {
  local label="$1"; shift
  "$@" >/dev/null 2>&1 || fail "$label should pass"
}

expect_invalid() {
  local label="$1" expected="$2"; shift 2
  local output
  if output="$("$@" 2>&1)"; then
    fail "$label should fail"
  fi
  echo "$output" | grep -qF "$expected" || {
    echo "$output" >&2
    fail "$label did not report: $expected"
  }
}

make_case() {
  local fixture="$1" target="$2" destination="$3"
  mkdir -p "$destination/$(dirname "$target")"
  cp "$fixtures/valid-v02/index.md" "$destination/index.md"
  cp "$fixtures/invalid/$fixture" "$destination/$target"
}

expect_valid "valid v0.2 base conformance" \
  ruby "$validator" --require-version 0.2 "$fixtures/valid-v02"
expect_valid "valid v0.2 strict profile" \
  ruby "$validator" --require-version 0.2 --strict "$fixtures/valid-v02"

scratch="$(mktemp -d "${TMPDIR:-/tmp}/agent-vault-okf-tests.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

for spec in \
  "missing-frontmatter.md|concept.md|missing leading YAML frontmatter|base" \
  "empty-type.md|concept.md|type must be a non-empty string|base" \
  "bad-yaml.md|concept.md|invalid YAML frontmatter|base" \
  "bad-index.md|nested/index.md|only the bundle-root index.md may have frontmatter|base" \
  "bad-log.md|log.md|log must contain ISO 8601 date headings|base" \
  "bad-lifecycle.md|concept.md|status must be draft, stable, or deprecated|strict" \
  "legacy-timestamp.md|concept.md|timestamp is legacy v0.1 metadata|strict" \
  "bad-trust.md|concept.md|generated.by must follow the OKF actor convention|strict" \
  "bad-attested.md|concept.md|Attested Computation requires runtime|strict" \
  "attested-outside-section.md|concept.md|Attested Computation requires exactly one fenced code block under # Computation|strict" \
  "attested-multiple-blocks.md|concept.md|Attested Computation requires exactly one fenced code block under # Computation|strict" \
  "attested-path-and-inline.md|concept.md|Attested Computation with computation path must omit # Computation code|strict"
do
  fixture="${spec%%|*}"; rest="${spec#*|}"
  target="${rest%%|*}"; rest="${rest#*|}"
  expected="${rest%%|*}"; profile="${rest##*|}"
  bundle="$scratch/case-${fixture%.md}"
  make_case "$fixture" "$target" "$bundle"
  args=(ruby "$validator" --require-version 0.2)
  [[ "$profile" == "strict" ]] && args+=(--strict)
  args+=("$bundle")
  expect_invalid "$fixture" "$expected" "${args[@]}"
done

utf8_bundle="$scratch/case-invalid-utf8"
mkdir -p "$utf8_bundle"
cp "$fixtures/valid-v02/index.md" "$utf8_bundle/index.md"
printf '%s\n' '---' 'type: Example' '---' '# Invalid UTF-8' > "$utf8_bundle/concept.md"
printf '\377' >> "$utf8_bundle/concept.md"
expect_invalid "invalid UTF-8" "not valid UTF-8" \
  ruby "$validator" --require-version 0.2 "$utf8_bundle"

# Optional v0.2 families are soft for base conformance and enforced only by the
# agent-vault producer profile. This preserves OKF's permissive consumer contract.
for fixture in bad-lifecycle.md legacy-timestamp.md bad-trust.md bad-attested.md; do
  bundle="$scratch/permissive-${fixture%.md}"
  make_case "$fixture" concept.md "$bundle"
  expect_valid "$fixture base conformance" \
    ruby "$validator" --require-version 0.2 "$bundle"
done

# Every source template must render as strict v0.2, including punctuation that
# used to break unquoted YAML scalars.
template_bundle="$scratch/templates"
ruby - "$plugin_root/templates" "$template_bundle" <<'RUBY'
require "fileutils"

templates, destination = ARGV
FileUtils.mkdir_p([
  destination,
  "#{destination}/knowledge",
  "#{destination}/docs/decisions",
  "#{destination}/journal",
  "#{destination}/handoffs"
])

values = {
  "{{PROJECT_NAME}}" => "Fixture: vault",
  "{{CREATED}}" => "2026-07-28",
  "{{TITLE}}" => "Decision: rotate keys",
  "{{TICKET_ID}}" => "TEST-001",
  "{{DESCRIPTION}}" => "Reason: keys need rotation.",
  "{{TAGS}}" => "auth, security",
  "{{TIMESTAMP}}" => "2026-07-28T12:00:00Z",
  "{{PRIORITY}}" => "p1",
  "{{ADR_ID}}" => "ADR-001",
  "{{STATUS}}" => "stable",
  "{{DECISION_STATUS}}" => "accepted",
  "{{DATETIME}}" => "2026-07-28 12:00",
  "{{DATE}}" => "2026-07-28",
  "{{SESSION_ID}}" => "fixture-session",
  "{{HEADING}}" => "Knowledge",
  "{{REL_PATH}}" => "note.md"
}

def render(source, target, values)
  content = File.read(source)
  values.each { |placeholder, value| content = content.gsub(placeholder, value) }
  unresolved = content.scan(/\{\{[A-Z_]+\}\}/)
  raise "unresolved placeholders in #{source}: #{unresolved.join(", ")}" unless unresolved.empty?
  File.write(target, content)
end

render("#{templates}/bundle-index.md", "#{destination}/index.md", values)
render("#{templates}/project-README.md", "#{destination}/README.md", values)
render("#{templates}/note.md", "#{destination}/knowledge/note.md", values)
render("#{templates}/index.md", "#{destination}/knowledge/index.md", values)
render("#{templates}/doc.md", "#{destination}/docs/reference.md", values)
render("#{templates}/adr.md", "#{destination}/docs/decisions/ADR-001-rotate.md", values)
render("#{templates}/journal-entry.md", "#{destination}/journal/2026-07-28.md", values)
render("#{templates}/handoff.md", "#{destination}/handoffs/2026-07-28-1200.md", values)
RUBY
python3 "$plugin_root/bin/task-db.py" init "$template_bundle" >/dev/null
task_body="$scratch/template-task-body.md"
printf '# TEST-001\n\n## Acceptance\nReason: keys need rotation.\n' > "$task_body"
python3 "$plugin_root/bin/task-db.py" create "$template_bundle" \
  --key TEST-001 --title 'TEST-001: Decision: rotate keys' \
  --description 'Reason: keys need rotation.' --priority p1 \
  --tags auth,security --body-file "$task_body" >/dev/null
expect_valid "rendered templates" \
  ruby "$validator" --require-version 0.2 --strict "$template_bundle"
template_index="$("$plugin_root/bin/vault-index.sh" "$template_bundle" --full)"
echo "$template_index" | grep -q 'Reason: keys need rotation.' ||
  fail "vault index did not decode folded description frontmatter"

# Bootstrap does not depend on the optional validator. Its generated templates
# are still checked explicitly here as a separate utility test.
scaffold="$scratch/Fixture & Pipes | Vault"
bootstrap_root="$scratch/bootstrap-without-validator"
mkdir -p "$bootstrap_root/bin" "$bootstrap_root/templates" "$bootstrap_root/lib" "$bootstrap_root/reference"
cp "$plugin_root/bin/bootstrap-project.sh" "$bootstrap_root/bin/bootstrap-project.sh"
cp "$plugin_root/bin/task-db.py" "$bootstrap_root/bin/task-db.py"
cp "$plugin_root/lib/__init__.py" "$bootstrap_root/lib/__init__.py"
cp "$plugin_root/lib/task_store.py" "$bootstrap_root/lib/task_store.py"
cp "$plugin_root/reference/task-schema.sql" "$bootstrap_root/reference/task-schema.sql"
cp "$plugin_root/templates/project-README.md" "$bootstrap_root/templates/project-README.md"
cp "$plugin_root/templates/bundle-index.md" "$bootstrap_root/templates/bundle-index.md"
chmod +x "$bootstrap_root/bin/bootstrap-project.sh"
expect_valid "bootstrap without validator" env CLAUDE_PLUGIN_ROOT="$bootstrap_root" \
  "$bootstrap_root/bin/bootstrap-project.sh" "$scaffold"
expect_valid "bootstrapped bundle" \
  ruby "$validator" --require-version 0.2 --strict "$scaffold"
grep -q '^  Fixture & Pipes | Vault$' "$scaffold/README.md" ||
  fail "bootstrap corrupted a YAML-sensitive project name"

# Upgrade is dry-run by default, preserves the source until --write, and produces
# a strict bundle with split workflow state.
legacy="$scratch/legacy"
cp -R "$fixtures/v01-agent-vault" "$legacy"
before="$(find "$legacy" -type f -print | sort | xargs shasum)"
expect_valid "upgrade dry run" ruby "$upgrader" "$legacy"
after="$(find "$legacy" -type f -print | sort | xargs shasum)"
[[ "$before" == "$after" ]] || fail "upgrade dry run changed files"
expect_valid "upgrade write" ruby "$upgrader" --write "$legacy"
expect_valid "upgraded bundle" \
  ruby "$validator" --require-version 0.2 --strict "$legacy"
grep -q '^decision_status: accepted$' "$legacy/docs/decisions/ADR-001-example.md" ||
  fail "decision workflow state was not migrated"
grep -q '^handoff_status: live$' "$legacy/handoffs/handoff.md" ||
  fail "handoff workflow state was not migrated"
grep -q '^task_status: blocked$' "$legacy/tasks/in-progress/task.md" ||
  fail "task workflow state was not migrated"
grep -q '^custom_field: keep-me$' "$legacy/knowledge/note.md" ||
  fail "custom frontmatter was not preserved"
if grep -rq '^timestamp:' "$legacy"; then
  fail "legacy timestamp survived upgrade"
fi

# A v0.1 extension may already use the v0.2 `generated` name with an
# incompatible shape. The upgrader must fail closed rather than erase it.
collision="$scratch/generated-collision"
cp -R "$fixtures/v01-agent-vault" "$collision"
ruby - "$collision/knowledge/note.md" <<'RUBY'
path = ARGV.fetch(0)
content = File.read(path)
content = content.sub(/^timestamp:.*$/, "\\0\ngenerated: keep-this-custom-value")
File.write(path, content)
RUBY
collision_before="$(find "$collision" -type f -print | sort | xargs shasum)"
expect_invalid "generated migration collision" "refusing to overwrite existing generated value" \
  ruby "$upgrader" --write "$collision"
collision_after="$(find "$collision" -type f -print | sort | xargs shasum)"
[[ "$collision_before" == "$collision_after" ]] ||
  fail "generated migration collision changed files"

# Handoff retirement is not blocked by an unrelated bundle version or format
# problem; it only edits the named handoff.
sed -e 's/okf_version: "0.2"/okf_version: "0.1"/' "$legacy/index.md" > "$legacy/index.tmp"
mv "$legacy/index.tmp" "$legacy/index.md"
"$plugin_root/bin/mark-handoff-spent.sh" "$legacy" handoff
grep -q '^status: deprecated$' "$legacy/handoffs/handoff.md" ||
  fail "spent handoff lifecycle was not deprecated"
grep -q '^handoff_status: spent$' "$legacy/handoffs/handoff.md" ||
  fail "spent handoff workflow state was not written"

# The durability helper commits only the named paths and does not inspect or
# enforce the bundle's OKF metadata.
commit_bundle="$scratch/commit-bundle"
cp -R "$fixtures/valid-v02" "$commit_bundle"
git -C "$commit_bundle" init -q
git -C "$commit_bundle" config user.name "OKF Fixture"
git -C "$commit_bundle" config user.email "okf@example.invalid"
git -C "$commit_bundle" add .
git -C "$commit_bundle" commit -qm "fixture"
printf '\nValid edit.\n' >> "$commit_bundle/concept.md"
expect_valid "valid durability commit" env CLAUDE_PLUGIN_ROOT="$plugin_root" \
  "$plugin_root/bin/vault-commit.sh" "docs(vault): valid fixture" "$commit_bundle/concept.md"
sed -e 's/^status: stable$/status: accepted/' "$commit_bundle/concept.md" > "$commit_bundle/concept.tmp"
mv "$commit_bundle/concept.tmp" "$commit_bundle/concept.md"
expect_valid "durability commit ignores OKF metadata" \
  env CLAUDE_PLUGIN_ROOT="$plugin_root" \
  "$plugin_root/bin/vault-commit.sh" "docs(vault): invalid fixture" "$commit_bundle/concept.md"
git -C "$commit_bundle" diff --quiet -- concept.md ||
  fail "durability helper left the named file uncommitted"

plain_repo="$scratch/plain-repo"
mkdir -p "$plain_repo"
git -C "$plain_repo" init -q
git -C "$plain_repo" config user.name "Plain Fixture"
git -C "$plain_repo" config user.email "plain@example.invalid"
printf 'first\n' > "$plain_repo/note.txt"
git -C "$plain_repo" add note.txt
git -C "$plain_repo" commit -qm "fixture"
printf 'second\n' >> "$plain_repo/note.txt"
expect_valid "durability commit without OKF bundle root" \
  "$plugin_root/bin/vault-commit.sh" "docs(vault): plain fixture" "$plain_repo/note.txt"
[[ "$(git -C "$plain_repo" rev-list --count HEAD)" == "2" ]] ||
  fail "durability helper required an OKF bundle root"

# A relative path names a file from the caller's directory, including a project
# bundle nested below the vault repository's root.
nested_vault="$scratch/nested-vault"
mkdir -p "$nested_vault/project/journal"
git -C "$nested_vault" init -q
git -C "$nested_vault" config user.name "Nested Fixture"
git -C "$nested_vault" config user.email "nested@example.invalid"
printf 'first\n' > "$nested_vault/project/journal/day.md"
git -C "$nested_vault" add project/journal/day.md
git -C "$nested_vault" commit -qm "fixture"
printf 'second\n' >> "$nested_vault/project/journal/day.md"
expect_valid "durability commit from a relative path" \
  bash -c 'cd "$1/project" && "$2" "docs(vault): relative fixture" journal/day.md' \
  _ "$nested_vault" "$plugin_root/bin/vault-commit.sh"
[[ "$(git -C "$nested_vault" rev-list --count HEAD)" == "2" ]] ||
  fail "durability helper skipped a file named by a relative path"

# Rename protects against ambiguous or destructive filesystem targets, but does
# not inspect bundle conformance or reserve OKF filenames.
rename_bundle="$scratch/rename-bundle"
cp -R "$fixtures/valid-v02" "$rename_bundle"
sed -e 's/okf_version: "0.2"/okf_version: "0.1"/' "$rename_bundle/index.md" > "$rename_bundle/index.tmp"
mv "$rename_bundle/index.tmp" "$rename_bundle/index.md"
expect_valid "concept rename" \
  "$plugin_root/bin/rename-concept.sh" "$rename_bundle" concept.md renamed.md
[[ -f "$rename_bundle/renamed.md" && ! -e "$rename_bundle/concept.md" ]] ||
  fail "concept rename did not move the file"
expect_valid "rename to formerly reserved filename" \
  "$plugin_root/bin/rename-concept.sh" "$rename_bundle" renamed.md knowledge/index.md
[[ -f "$rename_bundle/knowledge/index.md" && ! -e "$rename_bundle/renamed.md" ]] ||
  fail "rename to index.md did not move the file"

# The post-commit hook appends and durability-commits the active task without
# gating on the bundle's declared OKF version.
source_repo="$scratch/source"
vault_root="$scratch/hook-vault"
hook_tmp="$scratch/hook-tmp"
mkdir -p "$source_repo" "$vault_root" "$hook_tmp"
git -C "$source_repo" init -q
git -C "$source_repo" config user.name "Source Fixture"
git -C "$source_repo" config user.email "source@example.invalid"
printf 'fixture\n' > "$source_repo/README.txt"
git -C "$source_repo" add README.txt
source_receipt="$(git -C "$source_repo" commit -m "source fixture")"
cp -R "$template_bundle" "$vault_root/source"
python3 "$plugin_root/bin/task-db.py" transition "$vault_root/source" TEST-001 todo >/dev/null
python3 "$plugin_root/bin/task-db.py" transition "$vault_root/source" TEST-001 in-progress >/dev/null
sed -e 's/okf_version: "0.2"/okf_version: "0.1"/' "$vault_root/source/index.md" > "$vault_root/source/index.tmp"
mv "$vault_root/source/index.tmp" "$vault_root/source/index.md"
git -C "$vault_root" init -q
git -C "$vault_root" config user.name "Vault Fixture"
git -C "$vault_root" config user.email "vault@example.invalid"
git -C "$vault_root" add .
git -C "$vault_root" commit -qm "vault fixture"
source_sha="$(git -C "$source_repo" rev-parse --short HEAD)"
(
  cd "$source_repo"
  jq -n --arg receipt "$source_receipt" '{tool_input: {command: "git commit -m fixture"}, tool_response: {stdout: $receipt}}' |
    env AGENT_VAULT="$vault_root" PLUGIN_ROOT="$plugin_root" TMPDIR="$hook_tmp" \
      "$plugin_root/bin/hook-git-commit-link.sh"
)
python3 "$plugin_root/bin/task-db.py" show "$vault_root/source" TEST-001 | grep -qF "\`$source_sha\`" ||
  fail "post-commit hook did not link the source commit"
[[ "$(git -C "$vault_root" rev-list --count HEAD)" == "2" ]] ||
  fail "post-commit hook did not durability-commit the task update"

echo "PASS: optional OKF utilities and non-blocking vault write paths"
