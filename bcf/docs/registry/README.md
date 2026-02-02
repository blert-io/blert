# BCF Identifier Registry

This registry documents the canonical identifiers used in BCF documents. Each
category of identifier (attack types, spell types, phase types, etc.) is
maintained in a separate JSON file under `categories/`.

## Purpose

The registry serves as the canonical documentation source for known BCF
identifiers and their meanings. It serves several purposes:

1. **Documentation**: Human-readable descriptions of what each identifier means
2. **Lifecycle tracking**: Identifiers can be deprecated and replaced over time
3. **Discovery**: Helps BCF authors find the correct identifiers to use

## Categories

| File                        | BCF Field              | Description                       |
| --------------------------- | ---------------------- | --------------------------------- |
| `attack-type.json`          | `attack.attackType`    | Player attack identifiers         |
| `spell-type.json`           | `spell.spellType`      | Player spell identifiers          |
| `utility-type.json`         | `utility.utilityType`  | Player utility action identifiers |
| `npc-attack-type.json`      | `npcAttack.attackType` | NPC attack identifiers            |
| `npc-phase-type.json`       | `npcPhase.phaseType`   | NPC phase transition identifiers  |
| `encounter-phase-type.json` | `phases[].phaseType`   | Encounter-level phase identifiers |

## Category File Structure

Each category file is a JSON object with the following structure:

```json
{
  "category": "attackType",
  "updatedAt": "2026-01-22",
  "items": [ ... ]
}
```

| Field       | Type   | Description                     |
| ----------- | ------ | ------------------------------- |
| `category`  | string | Category identifier (camelCase) |
| `updatedAt` | string | ISO date of last update         |
| `items`     | array  | Array of registry items         |

## Registry Item Fields

### Required Fields

| Field        | Type   | Description                                    |
| ------------ | ------ | ---------------------------------------------- |
| `id`         | string | The canonical identifier used in BCF documents |
| `status`     | string | Lifecycle status: `active` or `deprecated`     |
| `summary`    | string | Brief one-line description                     |
| `introduced` | string | ISO date when the identifier was added         |

### Optional Fields

| Field        | Type     | Description                                           |
| ------------ | -------- | ----------------------------------------------------- |
| `details`    | string   | Longer explanation of when/how the identifier applies |
| `tags`       | string[] | Categorization tags for filtering and grouping        |
| `deprecated` | string   | ISO date when the identifier was deprecated           |
| `replacedBy` | string   | Identifier that supersedes this one (if applicable)   |
| `aliases`    | string[] | Alternative identifiers that map to this one          |

## Lifecycle

Identifiers follow this lifecycle:

1. **Active**: The identifier is current and should be used
2. **Deprecated**: The identifier is still valid but should not be used for new
   documents. If the identifier was replaced, `replacedBy` will point to the new
   identifier.

Deprecated identifiers are never removed to maintain history and ensure that
they are not reused.

## Aliases

Aliases are historical or shorthand identifiers that BCF tooling may accept and
normalize to the canonical ID. The registry does not require BCF documents to
use aliases; authors should prefer canonical ID values.

## Example Item

```json
{
  "id": "TOB_VERZIK_P2",
  "status": "active",
  "summary": "Verzik phase 2",
  "introduced": "2026-01-22",
  "details": "Occurs on the tick Verzik's P1 NPC despawns and switches to the transition animation to P2.",
  "tags": ["tob", "verzik"]
}
```
