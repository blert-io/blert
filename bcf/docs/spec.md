# Blert Chart Format (BCF) Specification

|                  |            |
| ---------------- | ---------- |
| **Version**      | 1.0        |
| **Status**       | Draft      |
| **Last Updated** | 2026-01-04 |

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

BCF captures core combat data: player attacks, player spells, player deaths,
and NPC attacks. It intentionally excludes:

- Player positions and movement
- Equipment and inventory state
- Skill levels and boost tracking
- NPC hitpoints over time including death

These exclusions keep BCF focused and portable. Renderers requiring additional
data should use a supplementary context mechanism outside the BCF specification.

### 1.3 Terminology

| Term         | Definition                                                   |
| ------------ | ------------------------------------------------------------ |
| Actor        | An entity that can perform actions (player or NPC)           |
| Tick         | OSRS game tick                                               |
| Cell         | The intersection of an actor and a tick in the timeline grid |
| Action       | Something an actor does on a tick (attack, spell, death)     |
| Augmentation | Optional display hints that enhance rendering                |
| Renderer     | A program that displays a BCF document as a visual chart     |

## 2. Document Structure

A BCF document is a JSON object with the following top-level structure. The
canonical file extension is `.bcf.json`.

```json
{
  "version": "1.0",
  "name": "Optional chart name",
  "description": "Optional description",
  "config": { ... },
  "timeline": { ... },
  "augmentation": { ... }
}
```

### 2.1 Required Fields

| Field      | Type   | Description                                |
| ---------- | ------ | ------------------------------------------ |
| `version`  | string | BCF specification version. Must be `"1.0"` |
| `config`   | object | Timeline configuration                     |
| `timeline` | object | Core timeline data (actors and ticks)      |

### 2.2 Optional Fields

| Field          | Type   | Description                          |
| -------------- | ------ | ------------------------------------ |
| `name`         | string | Human-readable name for the chart    |
| `description`  | string | Longer description or notes          |
| `augmentation` | object | Display hints for enhanced rendering |

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

| Field        | Type     | Required | Default          | Description                                                                            |
| ------------ | -------- | -------- | ---------------- | -------------------------------------------------------------------------------------- |
| `totalTicks` | integer  | Yes      | -                | Total number of ticks in the timeline                                                  |
| `startTick`  | integer  | No       | 0                | First display tick in the timeline                                                     |
| `endTick`    | integer  | No       | `totalTicks - 1` | Last display tick in the timeline (inclusive)                                          |
| `rowOrder`   | string[] | No       | -                | Ordered list of actor IDs defining row display order. Custom row IDs may also be used. |

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
rows in a default order (typically NPCs, custom rows, players).

- All entries in `rowOrder` must uniquely reference valid actor IDs or custom
  row IDs.
- Actors/rows not listed in `rowOrder` are omitted from rendering.
- `rowOrder` cannot be empty if present.

### 3.4 Validation

- `totalTicks` must be a positive integer.
- `startTick` must be a non-negative integer less than `totalTicks`, and less
  than or equal to `endTick` if provided.
- `endTick` must be a non-negative integer less than `totalTicks`, and greater
  than or equal to `startTick` if provided.
- All tick numbers in the timeline must be integers in the range
  `[0, totalTicks - 1]`.
- All IDs in `rowOrder` must exist as actor IDs or custom row IDs referencing
  (`augmentation.customRows[].id`).

## 4. Timeline (`timeline`)

The `timeline` object contains the core chart data:

```json
{
  "timeline": {
    "actors": [ ... ],
    "ticks": [ ... ]
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
  "name": "Verzik Vitur"
}
```

| Field   | Type    | Required | Description                            |
| ------- | ------- | -------- | -------------------------------------- |
| `type`  | string  | Yes      | Must be `"npc"`                        |
| `id`    | string  | Yes      | Unique identifier within this document |
| `npcId` | integer | Yes      | OSRS NPC ID at spawn                   |
| `name`  | string  | Yes      | Display name                           |

#### 4.1.3 Actor ID Requirements

- Actor IDs must be unique within the document
- IDs should be URL-safe strings (alphanumeric, hyphens, underscores)
- Recommended patterns: `"p1"`, `"player-1"`, `"verzik"`, `"nylo-boss"`

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

## 5. Actions

Actions represent what an actor does on a specific tick.

### 5.1 Action Types

BCF defines four action types:

| Type        | Actor Type | Description             |
| ----------- | ---------- | ----------------------- |
| `attack`    | Player     | Player offensive action |
| `spell`     | Player     | Player spell cast       |
| `npcAttack` | NPC        | NPC attack              |
| `death`     | Player     | Player death            |

### 5.2 Player Attack Action

```json
{
  "type": "attack",
  "attackType": "SCYTHE",
  "weaponId": 22325,
  "weaponName": "Scythe of vitur",
  "targetActorId": "verzik",
  "distanceToTarget": 1,
  "display": { ... }
}
```

| Field              | Type    | Required | Description                                              |
| ------------------ | ------- | -------- | -------------------------------------------------------- |
| `type`             | string  | Yes      | Must be `"attack"`                                       |
| `attackType`       | string  | Yes      | Attack type identifier (see §5.6)                        |
| `weaponId`         | integer | No       | OSRS item ID of the weapon                               |
| `weaponName`       | string  | No       | Weapon name for display                                  |
| `targetActorId`    | string  | No       | ID of the attack's primary target                        |
| `distanceToTarget` | integer | No       | Chebyshev distance between the attacker and target       |
| `specCost`         | integer | No       | Spec energy cost, 0-100 (only valid for `_SPEC` attacks) |
| `display`          | object  | No       | Display hints (see §5.7)                                 |

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
  "targetActorId": "p2",
  "display": { ... }
}
```

| Field           | Type   | Required | Description                       |
| --------------- | ------ | -------- | --------------------------------- |
| `type`          | string | Yes      | Must be `"spell"`                 |
| `spellType`     | string | Yes      | Spell type identifier (see §5.6)  |
| `targetActorId` | string | No       | Target actor's ID (if applicable) |
| `display`       | object | No       | Display hints (see §5.7)          |

### 5.4 Death Action

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

### 5.5 NPC Attack Action

```json
{
  "type": "npcAttack",
  "attackType": "TOB_VERZIK_P2_BOUNCE",
  "targetActorId": "p1",
  "display": { ... }
}
```

| Field           | Type   | Required | Description                           |
| --------------- | ------ | -------- | ------------------------------------- |
| `type`          | string | Yes      | Must be `"npcAttack"`                 |
| `attackType`    | string | Yes      | NPC attack type identifier (see §5.6) |
| `targetActorId` | string | No       | Target actor's ID                     |
| `display`       | object | No       | Display hints (see §5.7)              |

### 5.6 Action Type Identifiers

Action type identifiers use string names that correspond to canonical identifier
lists maintained by Blert.

#### 5.6.1 Canonical Sources

The canonical lists of action types defined by the Blert project exist as enums
in [`event.proto`](https://raw.githubusercontent.com/blert-io/protos/refs/heads/main/event.proto).
The names of the fields in these enums are valid action type identifiers that
renderers should aim to support.

The proto identifiers are provided as a reference for BCF renderer implementers.
It is not necessary to fetch and parse the proto file itself.

| Action Type    | Enum name      | Examples                                                      |
| -------------- | -------------- | ------------------------------------------------------------- |
| Player attacks | `PlayerAttack` | `SCYTHE`, `SANG`, `DAWN_SPEC`                                 |
| Player spells  | `PlayerSpell`  | `VENGEANCE`, `DEATH_CHARGE`, `VENGEANCE_OTHER`                |
| NPC attacks    | `NpcAttack`    | `TOB_VERZIK_P2_BOUNCE`, `TOB_MAIDEN_AUTO`, `INFERNO_JAD_MAGE` |

#### 5.6.2 Custom Action Types

BCF authors may choose to anticipate a future canonical type addition by setting
a custom name following the naming convention of the canonical sources.
Renderers that recognize the name will use their native display, while renderers
that do not can fall back to display hints.

For example, `DEMONBANE_CUTLASS` and `DEMONBANE_CUTLASS_SPEC` could be set on an
`attack` to anticipate the addition of a hypothetical "Demonbane Cutlass"
weapon.

When naming a custom action type, the following rules should be followed:

- Type names must be `UPPER_SNAKE_CASE`.
- The name `UNKNOWN` is reserved for unknown action types.
- The prefix `UNKNOWN_` is reserved for categories of unknown action types.
- The suffix `_SPEC` for attack actions must only be used for special attacks.
  Specifying `specCost` for a custom `_SPEC` attack is recommended.

When specifying a custom action type, BCF authors should include a `display`
hint to provide fallback rendering information.

#### 5.6.3 Unknown Action Types

An action type of `UNKNOWN` indicates that the action must be treated as
unrecognized (i.e., never matched against renderer metadata). It is recommended
to provide a `display` hint to provide fallback rendering; otherwise, the action
will render as a generic unknown action.

The `UNKNOWN_` prefix is reserved for categories of unknown action types,
several of which exist in the canonical sources. Unlike the generic `UNKNOWN`,
renderers may have additional category-specific native display information and
treat these identifiers as recognized. A `display` hint is still recommended,
but may be ignored by the renderer.

#### 5.6.4 Examples

```json
{
  "type": "attack",
  "attackType": "UNKNOWN",
  "display": {
    "iconUrl": "/images/custom-weapon.png",
    "letter": "X",
    "style": "melee"
  }
}
```

```json
{
  "type": "spell",
  "spellType": "UNKNOWN",
  "display": {
    "iconUrl": "/images/custom-spell.png",
    "name": "Custom Spell"
  }
}
```

```json
{
  "type": "npcAttack",
  "attackType": "UNKNOWN",
  "display": {
    "iconUrl": "/images/custom-npc-attack.png",
    "description": "Custom NPC attack"
  }
}
```

### 5.7 Display Hints

The `display` object allows BCF documents to provide fallback rendering for
custom or unknown action types.

#### 5.7.1 Attack Display Hint

```json
{
  "display": {
    "iconUrl": "/images/custom.png",
    "letter": "X",
    "style": "melee"
  }
}
```

| Field     | Type   | Description                                       |
| --------- | ------ | ------------------------------------------------- |
| `iconUrl` | string | URL or path to icon image                         |
| `letter`  | string | Short text for compact display mode               |
| `style`   | string | Combat style: `"melee"`, `"ranged"`, or `"magic"` |

#### 5.7.2 Spell Display Hint

```json
{
  "display": {
    "iconUrl": "/images/spell.png",
    "name": "Custom Spell"
  }
}
```

| Field     | Type   | Description               |
| --------- | ------ | ------------------------- |
| `iconUrl` | string | URL or path to spell icon |
| `name`    | string | Spell name for tooltips   |

#### 5.7.3 NPC Attack Display Hint

```json
{
  "display": {
    "iconUrl": "/images/npc-attack.png",
    "description": "Custom attack description"
  }
}
```

| Field         | Type   | Description                |
| ------------- | ------ | -------------------------- |
| `iconUrl`     | string | URL or path to attack icon |
| `description` | string | Description for tooltips   |

## 6. Cell State

The `state` object captures optional actor state that persists or is notable
beyond actions:

```json
{
  "state": {
    "isDead": true,
    "offCooldown": false,
    "specEnergy": 50,
    "label": "32",
    "customStates": [ ... ]
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

| Field   | Type   | Description           |
| ------- | ------ | --------------------- |
| `label` | string | Text label to display |

#### Common State

| Field          | Type  | Description                 |
| -------------- | ----- | --------------------------- |
| `customStates` | array | Additional state indicators |

### 6.2 Custom States

Custom states allow challenge-specific annotations:

```json
{
  "customStates": [
    {
      "label": "24",
      "fullText": "Healed Verzik for 24",
      "iconUrl": "/images/verzik-tornado.png"
    }
  ]
}
```

| Field      | Type   | Required | Description                    |
| ---------- | ------ | -------- | ------------------------------ |
| `label`    | string | No       | Short label for display        |
| `iconUrl`  | string | No       | Icon to display with the state |
| `fullText` | string | No       | Readable description           |

`label` and `iconUrl` control the display of the custom state on the cell.

Ordering of custom states is not significant.

**Validation**

- At least one of `label` or `iconUrl` must be provided.
- `label` must be 1-4 characters long if provided.

### 6.3 State Persistence and Merging

State fields have different persistence behaviors:

#### 6.3.1 Persistent Fields

These fields carry forward across ticks until explicitly changed:

| Field        | Persists | Default     |
| ------------ | -------- | ----------- |
| `isDead`     | Yes      | `false`     |
| `specEnergy` | Yes      | `undefined` |

At tick 0, all actors start with default values for persistent fields unless
explicitly specified in their first cell.

Persistent state is computed over the entire `[0, totalTicks - 1]` domain.

When a persistent state (e.g., `isDead`) is in effect, renderers should reflect
it even on ticks where the actor's cell is omitted.

#### 6.3.2 Non-Persistent Fields

These fields apply only to the tick where they are specified:

| Field          | Persists | Default                                                      |
| -------------- | -------- | ------------------------------------------------------------ |
| `offCooldown`  | No       | If omitted, renderer may derive; otherwise, treat as unknown |
| `label`        | No       | (none)                                                       |
| `customStates` | No       | `[]`                                                         |

#### 6.3.3 Merging Behavior

When `state` is provided on a cell, it merges with the current persistent state:

1. Omitted ticks/cells: Persistent fields carry forward, non-persistent reset.
2. Partial `state` object: Only specified fields are updated; unspecified
   persistent fields retain their previous values.

## 7. Augmentation Layer

The `augmentation` object provides optional display hints that enhance rendering
but are not part of the core timeline data:

```json
{
  "augmentation": {
    "splits": [ ... ],
    "backgroundColors": [ ... ],
    "customRows": [ ... ]
  }
}
```

### 7.1 Splits

Splits mark significant points in the timeline:

```json
{
  "splits": [
    {
      "tick": 25,
      "name": "70s"
    },
    {
      "tick": 50,
      "name": "50s"
    }
  ]
}
```

| Field  | Type    | Required | Default | Description                    |
| ------ | ------- | -------- | ------- | ------------------------------ |
| `tick` | integer | Yes      | -       | Tick on which the split occurs |
| `name` | string  | Yes      | -       | Split label                    |

### 7.2 Background Colors

Background colors highlight tick ranges to draw attention to significant events:

```json
{
  "backgroundColors": [
    {
      "tick": 8,
      "length": 1,
      "color": "cyan"
    },
    {
      "tick": 20,
      "length": 5,
      "color": "red",
      "intensity": "high",
      "rowIds": ["p1", "p2"]
    }
  ]
}
```

| Field       | Type     | Required | Default  | Description                                                          |
| ----------- | -------- | -------- | -------- | -------------------------------------------------------------------- |
| `tick`      | integer  | Yes      | -        | Starting tick                                                        |
| `length`    | integer  | No       | 1        | Number of ticks to color                                             |
| `color`     | string   | Yes      | -        | `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `gray` |
| `intensity` | string   | No       | `medium` | `low`, `medium`, `high`                                              |
| `rowIds`    | string[] | No       | -        | Actor/custom row IDs to color. If omitted, all rows.                 |

#### 7.2.1 Supported Colors

Instead of prescriptive hex color codes, BCF defines a small set of named color
tokens. Renderers must map each token to a theme-appropriate color value. The
exact mapping is left to the renderer to allow for visual consistency with its
theme.

#### 7.2.2 Color Intensity

The `intensity` field hints at how visually prominent the background should be.
Renderers commonly implement intensity via opacity, but may also adjust
saturation/brightness as needed.

Renderers should preserve relative ordering: `high` is more prominent than
`medium`, which is more prominent than `low`.

#### 7.2.3 Precedence

When multiple background colors are defined for the same tick and row, the last
one defined takes precedence.

#### 7.2.4 Validation

- `tick` must be in the range `[0, totalTicks - 1]`.
- `length` must be a positive integer.
- `tick + length` must be in the range `[1, totalTicks]`.
- `rowIds` must not be empty if provided.
- All entries in `rowIds` must be unique and reference valid actor IDs or custom
  row IDs.

### 7.3 Custom Rows

Custom rows display challenge-specific data that doesn't fit into the actor
model. They typically appear between NPC rows and player rows in the timeline
grid.

#### 7.3.1 When to Use Custom Rows

Custom rows are appropriate for:

- **Mechanics with their own timing**: Delayed damage application, hazards,
  mechanics that occur independently of actor actions, etc.
- **Event markers**: Notable events that affect the encounter but aren't actor
  attacks (e.g. Dawnbringer drops).

Custom rows are not appropriate for:

- Data that belongs to a specific actor (use `customStates` in cells instead)
- Split markers (use `augmentation.splits`)
- Tick highlighting (use `augmentation.backgroundColors`)

#### 7.3.2 Example: Mokhaiotl Orbs

In the Mokhaiotl challenge, orbs deal delayed damage to players. The damage tick
is offset from the attack tick and orbs can originate from multiple sources.
A custom row tracks when orb damage is applied, allowing verification of whether
the player was praying correctly:

```json
{
  "customRows": [
    {
      "id": "orbs",
      "name": "Orbs",
      "cells": [
        {
          "tick": 15,
          "iconUrl": "/images/mokhaiotl/ranged-orb.png",
          "label": "R",
          "opacity": 0.5
        },
        {
          "tick": 23,
          "iconUrl": "/images/mokhaiotl/magic-orb.png",
          "label": "M",
          "opacity": 0.5
        }
      ]
    }
  ]
}
```

#### 7.3.3 Custom Row Definition

| Field   | Type   | Required | Description                                  |
| ------- | ------ | -------- | -------------------------------------------- |
| `id`    | string | Yes      | Unique identifier for this row               |
| `name`  | string | Yes      | Display name shown in the legend             |
| `cells` | array  | Yes      | Sparse array of cells (only ticks with data) |

`id` must be unique and must not conflict with any actor ID in
`timeline.actors`.

#### 7.3.4 Custom Row Cell

| Field     | Type    | Required | Default | Description                       |
| --------- | ------- | -------- | ------- | --------------------------------- |
| `tick`    | integer | Yes      | -       | Tick number for this cell         |
| `iconUrl` | string  | No       | -       | Icon URL to display               |
| `label`   | string  | No       | -       | Short text label (1-3 characters) |
| `opacity` | number  | No       | 1.0     | Opacity (0.0-1.0)                 |

At least one of `iconUrl` or `label` should be provided for the cell to render
content.

## 8. Rendering Guidance

This section provides non-normative guidance for BCF renderers.

### 8.1 Grid Layout

BCF represents a grid where:

- **Columns** are ticks
- **Rows** are actors, ordered by `config.rowOrder` if provided, otherwise using
  a default order (typically: NPCs, custom rows, players)

### 8.2 Action Type Resolution

Renderers should resolve action types as follows:

1. Look up the action type in the renderer's metadata. If found, use the
   renderer's custom display for the action.
2. If not found, attempt to use provided `display` hints.
3. If no `display` hints exist, fall back to default "unknown" rendering.

### 8.3 Empty Cells

- Cells with no actions and no state should render as empty
- Cells with `state.isDead = true` but no actions should indicate dead state
- Cells with `state.offCooldown = true` may be visually distinguished

### 8.4. Custom State

- Custom states should be displayed as secondary information attached to a cell.
- Rendering context permitting, images are preferred over text labels when both
  are provided.
- Renderers may reorder custom states to improve visual hierarchy.

### 8.5 Context Enhancement

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

| File                                                                       | Description                                                                                                                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`config-options.bcf.json`](../examples/config-options.bcf.json)           | Demonstrates `startTick`/`endTick` display range and `rowOrder` actor reordering and exclusion.                                                    |
| [`multiple-actions.bcf.json`](../examples/multiple-actions.bcf.json)       | All 7 non-empty combinations of player cell actions (attack, spell, death).                                                                        |
| [`state-tracking.bcf.json`](../examples/state-tracking.bcf.json)           | Demonstrates state merging and persistence, non-persistent state fields, including sparse ticks and explicit `isDead` override.                    |
| [`background-colors.bcf.json`](../examples/background-colors.bcf.json)     | All combinations of background colors and intensities, with alternating on and off cooldown ticks.                                                 |
| [`splits.bcf.json`](../examples/splits.bcf.json)                           | Demonstrates split markers to annotate phase transitions.                                                                                          |
| [`custom-row.bcf.json`](../examples/custom-row.bcf.json)                   | Demonstrates custom row cells with icon-only, label-only, and icon+label, including opacity.                                                       |
| [`custom-action-types.bcf.json`](../examples/custom-action-types.bcf.json) | Demonstrates canonical, custom, and unknown action identifiers across player attacks, player spells, and NPC attacks, with display hint fallbacks. |
| [`113-p1.bcf.json`](../examples/113-p1.bcf.json)                           | A complete example of a Verzik P1 chart.                                                                                                           |

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
