# Vendored: Hallmark

Source: https://github.com/nutlope/hallmark (MIT), `skills/hallmark/`
Commit: 04977e15f3dfd6ee4b74c887dac3eb52665d6c92 (2026-11-11), skill v2.0.0

Copied as-is so every Claude Code session in this repo gets `/hallmark`.
Do not edit these files; update by re-copying from upstream:

```bash
git clone --depth 1 https://github.com/nutlope/hallmark /tmp/hallmark
rm -rf .claude/skills/hallmark/{SKILL.md,LICENSE,references,scripts,agents}
cp -r /tmp/hallmark/skills/hallmark/{SKILL.md,LICENSE,references,scripts,agents} .claude/skills/hallmark/
node .claude/skills/hallmark/scripts/refcheck.mjs
```

It only fires on new builds, or when Hallmark is named
(`/hallmark redesign <path>`, `/hallmark audit <path>`). Its run log goes to
`.hallmark/`, which is gitignored.
