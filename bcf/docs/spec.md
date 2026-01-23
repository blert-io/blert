# Blert Chart Format (BCF) Specification

|                   |                                                              |
| ----------------- | ------------------------------------------------------------ |
| **Version**       | 1.0                                                          |
| **Status**        | Draft                                                        |
| **Last Updated**  | 2026-01-17                                                   |
| **Canonical URL** | https://github.com/blert-io/blert/blob/main/bcf/docs/spec.md |

## 1. Introduction

### 1.1 Purpose

The Blert Chart Format (BCF) is a JSON-based data interchange format for
representing combat timelines in Old School RuneScape. BCF enables:

1. **Portability**: Share attack rotations and fight timelines between users
2. **Decoupling**: Separate timeline data from rendering implementation
3. **Tooling**: Enable standalone viewers, chart editors, and analysis tools
4. **Compilation Target**: Serve as an output format for domain-specific
   languages

### 1.2 Scope

BCF is a curated timeline representation of a PvM encounter intended for
visualization.

BCF is not a complete replay of challenge events. BCF captures a subset of core
combat data. It intentionally excludes:

- Player positions and movement
- Equipment and inventory state
- Skill levels and boost tracking
- Actor hitpoints over time

BCF intentionally does not provide arbitrary extension fields. New
encounter-relevant semantics must be introduced via the identifier registry.

### 1.3 Terminology

| Term     | Definition                                                   |
| -------- | ------------------------------------------------------------ |
| Actor    | An entity that can perform actions (player or NPC)           |
| Tick     | OSRS game tick                                               |
| Cell     | The intersection of an actor and a tick in the timeline grid |
| Action   | Something an actor does on a tick (attack, spell, death)     |
| Renderer | A program that displays a BCF document as a visual chart     |

## 2. Document Structure

A BCF document is a JSON object with the following top-level structure. The
canonical file extension is `.bcf.json`.

```json
{
  "version": "1.0",
  "name": "Optional chart name",
  "description": "Optional description",
  "config": { ... },
  "timeline": { ... }
}
```

### 2.1 Required Fields

| Field      | Type   | Description                                |
| ---------- | ------ | ------------------------------------------ |
| `version`  | string | BCF specification version. Must be `"1.0"` |
| `config`   | object | Timeline configuration                     |
| `timeline` | object | Core timeline data (actors and ticks)      |

### 2.2 Optional Fields

| Field         | Type   | Description                       |
| ------------- | ------ | --------------------------------- |
| `name`        | string | Human-readable name for the chart |
| `description` | string | Longer description or notes       |

## 3. Configuration (`config`)

The `config` object defines timeline parameters:

```json
{
  "config": {
    "totalTicks": 80,
    "startTick": 1,
    "endTick": 79,
    "rowOrder": ["verzik", "p1", "p2", "p3"]
  }
}
```

### 3.1 Fields

| Field        | Type     | Required | Default          | Description                                           |
| ------------ | -------- | -------- | ---------------- | ----------------------------------------------------- |
| `totalTicks` | integer  | Yes      | -                | Total number of ticks in the timeline                 |
| `startTick`  | integer  | No       | 0                | First display tick in the timeline                    |
| `endTick`    | integer  | No       | `totalTicks - 1` | Last display tick in the timeline (inclusive)         |
| `rowOrder`   | string[] | No       | -                | Ordered list of actor IDs defining row display order. |

### 3.2. Tick Range

A BCF timeline represents a combat encounter that lasts for `totalTicks` ticks,
beginning at tick 0 and ending at tick `totalTicks - 1`.

In practice, it is sometimes useful to only display a subset of the timeline.
For example, in many encounters, tick 0 is not meaningful to players and does
not align with their mental model of the encounter, even if it does contain
relevant initial state information.

To accommodate this, optional `startTick` and `endTick` fields can be used to
specify the _display range_ of the timeline. Actions and state changes can (and
typically do) occur outside of this range and must still be resolved (see §6.3),
but should not be rendered.

If `startTick` and `endTick` are omitted, the display range defaults to the
entire timeline.

### 3.3 Row Order

When `rowOrder` is provided, it defines the set and order of rows that should be
displayed. Rows not listed in `rowOrder` may still exist in the document but are
omitted from rendering. When `rowOrder` is omitted, renderers should display all
rows in a default order (typically NPCs then players).

- All entries in `rowOrder` must uniquely reference valid actor IDs.
- Actors/rows not listed in `rowOrder` are omitted from rendering.
- `rowOrder` cannot be empty if present.

### 3.4 Validation

- `totalTicks` must be a positive integer.
- `startTick` must be a non-negative integer less than `totalTicks`, and less
  than or equal to `endTick` if provided.
- `endTick` must be a non-negative integer less than `totalTicks`, and greater
  than or equal to `startTick` if provided.
- All tick numbers in the timeline (in `ticks` and `phases`) must be integers in
  the range `[0, totalTicks - 1]`.
- All IDs in `rowOrder` must exist as actor IDs.

## 4. Timeline (`timeline`)

The `timeline` object contains the core chart data:

```json
{
  "timeline": {
    "actors": [ ... ],
    "ticks": [ ... ],
    "phases": [ ... ]
  }
}
```

### 4.1 Actors Array

Actors define the rows of the timeline grid. Each actor has a unique identifier.

#### 4.1.1 Player Actor

```json
{
  "type": "player",
  "id": "p1",
  "name": "PlayerName"
}
```

| Field  | Type   | Required | Description                            |
| ------ | ------ | -------- | -------------------------------------- |
| `type` | string | Yes      | Must be `"player"`                     |
| `id`   | string | Yes      | Unique identifier within this document |
| `name` | string | Yes      | Display name                           |

#### 4.1.2 NPC Actor

```json
{
  "type": "npc",
  "id": "verzik",
  "npcId": 8370,
  "name": "Verzik Vitur",
  "spawnTick": 0,
  "deathTick": 287
}
```

| Field       | Type    | Required | Description                            |
| ----------- | ------- | -------- | -------------------------------------- |
| `type`      | string  | Yes      | Must be `"npc"`                        |
| `id`        | string  | Yes      | Unique identifier within this document |
| `npcId`     | integer | Yes      | OSRS NPC ID at spawn                   |
| `name`      | string  | Yes      | Display name                           |
| `spawnTick` | integer | No       | First tick the NPC exists (default 0)  |
| `deathTick` | integer | No       | Tick the NPC dies; permanent removal   |

#### 4.1.3 Actor ID Requirements

- Actor IDs must be unique within the document
- IDs should be URL-safe strings (alphanumeric, hyphens, underscores)
- Recommended patterns: `"p1"`, `"player-1"`, `"verzik"`, `"nylo-boss"`

#### 4.1.4 NPC Lifecycle

NPCs may optionally define `spawnTick` and `deathTick` to describe their
lifecycle in the timeline.

- `spawnTick` defaults to `0` if omitted.
- `deathTick` is optional and indicates permanent removal.
- If `deathTick` is present, the NPC is considered dead from that tick onward.
- If `deathTick` is omitted, the NPC exists through the end of the timeline.
- Actions for an NPC must not appear outside `[spawnTick, deathTick]` (if
  `deathTick` is present). The NPC may perform actions on `deathTick` itself.

Validation:

- `spawnTick` and `deathTick` must be integers in `[0, totalTicks - 1]`.
- If both are present, `deathTick` must be strictly greater than `spawnTick`.

### 4.2 Ticks Array

The ticks array is a sparse, ascending array of tick objects.

```json
{
  "ticks": [
    {
      "tick": 0,
      "cells": [ ... ]
    },
    {
      "tick": 1,
      "cells": [ ... ]
    }
  ]
}
```

#### 4.2.1 Tick Object

| Field   | Type    | Required | Description                         |
| ------- | ------- | -------- | ----------------------------------- |
| `tick`  | integer | Yes      | Tick number (0 to `totalTicks - 1`) |
| `cells` | array   | Yes      | Array of cell objects for this tick |

#### 4.2.2 Tick Ordering and Sparsity

- Ticks must be in ascending order by tick number
- Tick numbers need not be consecutive; sparse arrays are permitted
- Each tick object in the array must have a unique tick number
- Ticks with no actions or state may be omitted entirely
- Renderers should treat missing ticks as empty (no actions, default state)

### 4.3 Cells Array

Each tick contains cells for actors that have data on that tick.

```json
{
  "cells": [
    {
      "actorId": "verzik",
      "actions": [ ... ],
      "state": { ... }
    }
  ]
}
```

#### 4.3.1 Cell Object

| Field     | Type   | Required | Description                 |
| --------- | ------ | -------- | --------------------------- |
| `actorId` | string | Yes      | References an actor's `id`  |
| `actions` | array  | No       | Actions performed this tick |
| `state`   | object | No       | Actor state flags           |

Within a tick, each `actorId` may appear at most once in `cells`. Multiple cells
referencing the same `actorId` are invalid.

#### 4.3.2 Multiple Actions

A cell may contain multiple actions of different types. This occurs when an
actor performs several things on the same tick.

```json
{
  "actorId": "p1",
  "actions": [
    { "type": "attack", "attackType": "SCYTHE" },
    { "type": "spell", "spellType": "VENGEANCE" },
    { "type": "death" }
  ]
}
```

Constraints:

- Each action type may appear at most once per cell
- Order within the array is not significant

#### 4.3.3 Cell Omission

- Cells may be omitted for actors with no actions and no relevant state on a
  tick.
- An empty cell (no actions, no state) is equivalent to omitting the cell.
- Renderers should treat missing cells as empty.

### 4.4 Phases Array

The optional `phases` array captures encounter-level phase transitions that are
not tied to a specific actor. This is distinct from `npcPhase` actions, which
represent phase transitions for a specific NPC.

```json
{
  "timeline": {
    "phases": [
      { "tick": 8, "phaseType": "TOB_NYLO_WAVE_1" },
      { "tick": 12, "phaseType": "TOB_NYLO_WAVE_2" }
    ]
  }
}
```

#### 4.4.1 Phase Object

| Field       | Type    | Required | Description                        |
| ----------- | ------- | -------- | ---------------------------------- |
| `tick`      | integer | Yes      | Tick number when the phase begins  |
| `phaseType` | string  | Yes      | Phase type identifier (see §4.4.2) |

#### 4.4.2 Phase Type Identifiers

Phase type identifiers use string names that correspond to canonical identifier
lists maintained by Blert.

TODO: Add canonical sources.

#### 4.4.3 Validation

- Phases must be in ascending order by tick number
- Each phase object must have a unique tick number
- If `phases` is present, it may be empty

#### 4.4.4 When to Use `phases` vs `npcPhase`

Use `timeline.phases` for encounter-level transitions that are not specific to
any single NPC:

- Wave spawns (e.g. Nylocas, Apmeken)
- Spawn events for groups of enemies (e.g. Maiden crabs, Colosseum adds)
- Global fight phases that affect the entire encounter (e.g. Sotetseg mazes)

Use `npcPhase` actions for phase transitions that belong to a specific NPC:

- Boss phase changes which modify its behavior (e.g. Verzik P1/P2/P3)
- Individual NPC state changes (e.g. Bloat up/down, Akkha combat style)

## 5. Actions

Actions represent what an actor does on a specific tick.

### 5.1 Action Types

BCF defines the following action types:

| Type        | Actor Type | Description             |
| ----------- | ---------- | ----------------------- |
| `attack`    | Player     | Player offensive action |
| `spell`     | Player     | Player spell cast       |
| `utility`   | Player     | Player utility action   |
| `death`     | Player     | Player death            |
| `npcAttack` | NPC        | NPC attack              |
| `npcPhase`  | NPC        | NPC phase transition    |

Actors are only allowed to perform actions of their own type. If an invalid
action type is specified for an actor type, it should be rejected.

NPC deaths are represented by actor `deathTick` (see §4.1.4), not by actions.

### 5.2 Player Attack Action

```json
{
  "type": "attack",
  "attackType": "SCYTHE",
  "weaponId": 22325,
  "weaponName": "Scythe of vitur",
  "targetActorId": "verzik",
  "distanceToTarget": 1,
  "damage": 67
}
```

| Field              | Type    | Required | Description                                              |
| ------------------ | ------- | -------- | -------------------------------------------------------- |
| `type`             | string  | Yes      | Must be `"attack"`                                       |
| `attackType`       | string  | Yes      | Attack type identifier (see §5.8)                        |
| `weaponId`         | integer | No       | OSRS item ID of the weapon                               |
| `weaponName`       | string  | No       | Weapon name for display                                  |
| `targetActorId`    | string  | No       | ID of the attack's primary target                        |
| `distanceToTarget` | integer | No       | Chebyshev distance between the attacker and target       |
| `damage`           | integer | No       | Total damage dealt directly by the attack to the target  |
| `specCost`         | integer | No       | Spec energy cost, 0-100 (only valid for `_SPEC` attacks) |

#### 5.2.1 Field Derivation

Some optional fields can be derived by the renderer from its metadata when
omitted. This allows BCF documents to be concise while still supporting explicit
values when needed.

| Field        | Example derivation                                    |
| ------------ | ----------------------------------------------------- |
| `weaponName` | Looked up from OSRS item database using `weaponId`    |
| `specCost`   | Looked up in renderer metadata for known attack types |

**Resolution order**: Explicit field values take precedence over derived values.
If both `weaponName` and `weaponId` are provided, the renderer should use the
provided `weaponName`. If only `weaponId` is provided, the renderer may look up
the name.

#### 5.2.2 Special Attacks

All attack type identifiers that end in `_SPEC` are considered special attacks.
Including `specCost` on a `_SPEC` attack is recommended. If omitted, renderers
may derive the cost from their metadata; otherwise, they should treat the cost
as unknown.

If the attack type does not end in `_SPEC`, `specCost` must not be set.

### 5.3 Player Spell Action

```json
{
  "type": "spell",
  "spellType": "VENGEANCE_OTHER",
  "targetActorId": "p2"
}
```

| Field           | Type   | Required | Description                       |
| --------------- | ------ | -------- | --------------------------------- |
| `type`          | string | Yes      | Must be `"spell"`                 |
| `spellType`     | string | Yes      | Spell type identifier (see §5.8)  |
| `targetActorId` | string | No       | Target actor's ID (if applicable) |

### 5.4 Utility Action

```json
{
  "type": "utility",
  "utilityType": "SURGE_POTION"
}
```

| Field         | Type   | Required | Description                        |
| ------------- | ------ | -------- | ---------------------------------- |
| `type`        | string | Yes      | Must be `"utility"`                |
| `utilityType` | string | Yes      | Utility type identifier (see §5.8) |

### 5.5 Death Action

```json
{
  "type": "death"
}
```

| Field  | Type   | Required | Description       |
| ------ | ------ | -------- | ----------------- |
| `type` | string | Yes      | Must be `"death"` |

Death indicates the player died on this tick. A death action implies
`state.isDead = true` beginning from this tick unless explicitly overridden.

NPCs must not use the `death` action. Use `deathTick` on the NPC actor instead.

### 5.6 NPC Attack Action

```json
{
  "type": "npcAttack",
  "attackType": "TOB_VERZIK_P2_BOUNCE",
  "targetActorId": "p1"
}
```

| Field           | Type   | Required | Description                           |
| --------------- | ------ | -------- | ------------------------------------- |
| `type`          | string | Yes      | Must be `"npcAttack"`                 |
| `attackType`    | string | Yes      | NPC attack type identifier (see §5.8) |
| `targetActorId` | string | No       | Target actor's ID                     |

### 5.7 NPC Phase Action

```json
{
  "type": "npcPhase",
  "phaseType": "TOB_VERZIK_P2"
}
```

| Field       | Type   | Required | Description                          |
| ----------- | ------ | -------- | ------------------------------------ |
| `type`      | string | Yes      | Must be `"npcPhase"`                 |
| `phaseType` | string | Yes      | NPC phase type identifier (see §5.8) |

### 5.8 Action Type Identifiers

Action type identifiers use string names that correspond to canonical identifier
lists maintained by Blert.

#### 5.8.1 Canonical Sources

The canonical lists of action types defined by the Blert project exist as enums
in [`event.proto`](https://raw.githubusercontent.com/blert-io/protos/refs/heads/main/event.proto).
The names of the fields in these enums are valid action type identifiers that
renderers should aim to support.

The list of canonical action type identifiers will expand over time as BCF
evolves.

The proto identifiers are provided as a reference for BCF renderer implementers.
It is not necessary to fetch and parse the proto file itself.

| Action Type    | Enum name      | Examples                                                      |
| -------------- | -------------- | ------------------------------------------------------------- |
| Player attacks | `PlayerAttack` | `SCYTHE`, `SANG`, `DAWN_SPEC`                                 |
| Player spells  | `PlayerSpell`  | `VENGEANCE`, `DEATH_CHARGE`, `VENGEANCE_OTHER`                |
| NPC attacks    | `NpcAttack`    | `TOB_VERZIK_P2_BOUNCE`, `TOB_MAIDEN_AUTO`, `INFERNO_JAD_MAGE` |

#### 5.8.2 Unknown Action Types

An action type of `UNKNOWN` indicates that the action must be treated as
unrecognized (i.e., never matched against renderer metadata).

The `UNKNOWN_` prefix is reserved for categories of unknown action types,
several of which exist in the canonical sources. Unlike the generic `UNKNOWN`,
renderers may have additional category-specific native display information and
treat these identifiers as recognized.

#### 5.8.3 Examples

```json
{
  "type": "attack",
  "attackType": "UNKNOWN_BARRAGE",
  "weaponId": 33333
}
```

```json
{
  "type": "spell",
  "spellType": "UNKNOWN"
}
```

```json
{
  "type": "npcAttack",
  "attackType": "UNKNOWN"
}
```

## 6. Cell State

The `state` object captures optional actor state that persists or is notable
beyond actions:

```json
{
  "state": {
    "isDead": true,
    "offCooldown": false,
    "specEnergy": 50
  }
}
```

### 6.1 State Fields

#### Player State

| Field         | Type    | Description                                     |
| ------------- | ------- | ----------------------------------------------- |
| `isDead`      | boolean | Player is dead                                  |
| `offCooldown` | boolean | Player was off attack cooldown and could attack |
| `specEnergy`  | integer | Remaining spec energy after action (0-100)      |

#### NPC State

At the moment, there is no NPC-specific state. NPC death is derived from
actor `deathTick` rather than `state`.

### 6.2 State Persistence and Merging

State fields have different persistence behaviors:

#### 6.2.1 Persistent Fields

These fields carry forward across ticks until explicitly changed:

| Field        | Persists | Default     |
| ------------ | -------- | ----------- |
| `isDead`     | Yes      | `false`     |
| `specEnergy` | Yes      | `undefined` |

At tick 0, all actors start with default values for persistent fields unless
explicitly specified in their first cell.

For NPCs, death is derived from actor `deathTick` and is not represented by
`state.isDead`.

Persistent state is computed over the entire `[0, totalTicks - 1]` domain.

When a persistent state (e.g., `isDead`) is in effect, renderers should reflect
it even on ticks where the actor's cell is omitted.

#### 6.2.2 Non-Persistent Fields

These fields apply only to the tick where they are specified:

| Field         | Persists | Default                                                      |
| ------------- | -------- | ------------------------------------------------------------ |
| `offCooldown` | No       | If omitted, renderer may derive; otherwise, treat as unknown |

#### 6.2.3 Merging Behavior

When `state` is provided on a cell, it merges with the current persistent state:

1. Omitted ticks/cells: Persistent fields carry forward, non-persistent reset.
2. Partial `state` object: Only specified fields are updated; unspecified
   persistent fields retain their previous values.

## 8. Rendering Guidance

This section provides non-normative guidance for BCF renderers.

### 8.1 Grid Layout

BCF represents a grid where:

- **Columns** are ticks
- **Rows** are actors, ordered by `config.rowOrder` if provided, otherwise using
  a default order (typically NPCs then players)

### 8.2 Action Type Resolution

Renderers should resolve action types as follows:

1. Look up the action type in the renderer's metadata. If found, use the
   renderer's native display for the action.
2. If not found, use the default "unknown" rendering.

### 8.3 Empty Cells

- Cells with no actions and no state should render as empty
- Cells with `state.isDead = true` but no actions should indicate dead state
- Cells with `state.offCooldown = true` may be visually distinguished

### 8.4 Context Enhancement

BCF documents may be rendered with additional context (e.g., full player state,
NPC hitpoints) provided by the rendering environment. Such context is outside
the BCF specification and is implementation-specific.

## 9. Examples

### 9.1 Minimal Document

This document shows a 3-tick encounter with a single action in the sparse tick
array.

```json
{
  "version": "1.0",
  "config": {
    "totalTicks": 3
  },
  "timeline": {
    "actors": [{ "type": "player", "id": "p1", "name": "Player" }],
    "ticks": [
      {
        "tick": 2,
        "cells": [
          {
            "actorId": "p1",
            "actions": [{ "type": "attack", "attackType": "SCYTHE" }]
          }
        ]
      }
    ]
  }
}
```

### 9.2 Example files

This repository provides canonical, complete example BCF documents under
`examples/`. These files are validated and are intended to serve as conformance
fixtures for implementers.

| File                                                                 | Description                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`config-options.bcf.json`](../examples/config-options.bcf.json)     | Demonstrates `startTick`/`endTick` display range and `rowOrder` actor reordering and exclusion.                                 |
| [`multiple-actions.bcf.json`](../examples/multiple-actions.bcf.json) | All 15 non-empty combinations of player cell actions (attack, spell, utility, death).                                           |
| [`npc-lifecycle.bcf.json`](../examples/npc-lifecycle.bcf.json)       | Demonstrates NPC lifecycle (spawnTick, deathTick) and action types (npcAttack, npcPhase).                                       |
| [`encounter-phases.bcf.json`](../examples/encounter-phases.bcf.json) | Demonstrates encounter-level `phases`.                                                                                          |
| [`state-tracking.bcf.json`](../examples/state-tracking.bcf.json)     | Demonstrates state merging and persistence, non-persistent state fields, including sparse ticks and explicit `isDead` override. |
| [`113-p1.bcf.json`](../examples/113-p1.bcf.json)                     | A complete example of a Verzik P1 chart.                                                                                        |

## 10. Versioning

### 10.1 Version Format

BCF uses semantic versioning for the specification: `MAJOR.MINOR`

- **MAJOR**: Incompatible changes to the format
- **MINOR**: Backwards-compatible additions

### 10.2 Version Handling

Renderers should:

1. Check the `version` field before processing
2. Reject documents with unsupported major versions
3. Accept documents with higher minor versions (ignoring unknown fields)

### 10.3 Version History

| Version | Date       | Changes               |
| ------- | ---------- | --------------------- |
| 1.0     | 2026-01-04 | Initial specification |

## Appendix A: JSON Schema

A formal JSON Schema for BCF structural validation is available in the
`@blert/bcf` package: `bcf/schemas/bcf-1.0-strict.schema.json`

## Appendix B: Reference Implementation

The reference implementation for BCF parsing and validation is the `@blert/bcf`
package, located at `/bcf` in the Blert monorepo.

The reference renderer is the Blert web application's BCF renderer component:
`web/app/components/attack-timeline/bcf-renderer.tsx`
