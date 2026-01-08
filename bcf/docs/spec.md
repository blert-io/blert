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
| Tick         | OSRS game tick. BCF uses 1-indexed ticks                     |
| Cell         | The intersection of an actor and a tick in the timeline grid |
| Action       | Something an actor does on a tick (attack, spell, death)     |
| Augmentation | Optional display hints that enhance rendering                |

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
    "totalTicks": 113,
    "rowOrder": ["verzik", "p1", "p2", "p3"],
    "definitions": {
      "attacks": "https://raw.githubusercontent.com/blert-io/protos/8b8d8981baa02a6bfb8fb7fb2e727d65ff7b8e1f/attack_definitions.json",
      "spells": "https://raw.githubusercontent.com/blert-io/protos/8b8d8981baa02a6bfb8fb7fb2e727d65ff7b8e1f/spell_definitions.json",
      "npcAttacks": "https://raw.githubusercontent.com/blert-io/protos/8b8d8981baa02a6bfb8fb7fb2e727d65ff7b8e1f/event.proto"
    }
  }
}
```

### 3.1 Fields

| Field         | Type     | Required | Default | Description                                                                            |
| ------------- | -------- | -------- | ------- | -------------------------------------------------------------------------------------- |
| `totalTicks`  | integer  | Yes      | -       | Total number of ticks in the timeline                                                  |
| `rowOrder`    | string[] | No       | -       | Ordered list of actor IDs defining row display order. Custom row IDs may also be used. |
| `definitions` | object   | No       | -       | Pinned canonical definition sources (see §3.2)                                         |

### 3.2 Definitions

The `definitions` object pins specific versions of canonical definition files.
When provided, renderers should use these versions to resolve attack types,
spell types, and NPC attack types. This ensures compatibility if the canonical
definitions change over time.

| Field        | Type   | Description                                 |
| ------------ | ------ | ------------------------------------------- |
| `attacks`    | string | URL to `attack_definitions.json`            |
| `spells`     | string | URL to `spell_definitions.json`             |
| `npcAttacks` | string | URL to `event.proto` (for `NpcAttack` enum) |

URIs must be full URLs to a valid JSON or proto file.

When `definitions` is omitted, renderers may use their bundled definitions or
fetch the latest versions from the canonical sources.

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
- All tick numbers in the timeline must be positive integers in the range
  `[1, totalTicks]`.
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
      "tick": 1,
      "cells": [ ... ]
    },
    {
      "tick": 2,
      "cells": [ ... ]
    }
  ]
}
```

#### 4.2.1 Tick Object

| Field   | Type    | Required | Description                         |
| ------- | ------- | -------- | ----------------------------------- |
| `tick`  | integer | Yes      | Tick number (1 to `totalTicks`)     |
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

| Field              | Type    | Required | Description                                        |
| ------------------ | ------- | -------- | -------------------------------------------------- |
| `type`             | string  | Yes      | Must be `"attack"`                                 |
| `attackType`       | string  | Yes      | Attack type identifier (see §5.6)                  |
| `weaponId`         | integer | No       | OSRS item ID of the weapon                         |
| `weaponName`       | string  | No       | Weapon name for display                            |
| `targetActorId`    | string  | No       | Target actor's ID                                  |
| `distanceToTarget` | integer | No       | Tiles away from target                             |
| `specCost`         | integer | No       | Spec energy cost (presence implies special attack) |
| `display`          | object  | No       | Display overrides (see §5.7)                       |

#### 5.2.1 Field Derivation

Many optional fields can be derived by the renderer from canonical sources when
omitted. This allows BCF documents to be concise while still supporting explicit
values when needed.

| Field        | Derivation                                         |
| ------------ | -------------------------------------------------- |
| `weaponName` | Looked up from OSRS item database using `weaponId` |
| `specCost`   | Looked up from canonical attack definitions        |
| `display`    | Resolved from canonical attack definitions         |

**Resolution order**: Explicit field values take precedence over derived values.
If both `weaponName` and `weaponId` are provided, the renderer should use the
provided `weaponName`. If only `weaponId` is provided, the renderer may look up
the name.

**Special attacks**: The presence of `specCost` indicates a special attack.
For standard attack types ending in `_SPEC`, the cost can be derived from
canonical definitions and the field may be omitted. For custom/unknown special
attacks, `specCost` should be provided explicitly.

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
| `display`       | object | No       | Display overrides (see §5.7)      |

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
| `display`       | object | No       | Display overrides (see §5.7)          |

### 5.6 Attack Type Identifiers

Attack type identifiers use string names that correspond to canonical attack
definitions. The Blert project maintains public definition files that renderers
can import to resolve attack types to display metadata.

#### 5.6.1 Canonical Sources

| Action Type    | Canonical Source                                                                                                       | Key Field |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | --------- |
| Player attacks | [`attack_definitions.json`](https://raw.githubusercontent.com/blert-io/protos/refs/heads/main/attack_definitions.json) | `name`    |
| Player spells  | [`spell_definitions.json`](https://raw.githubusercontent.com/blert-io/protos/refs/heads/main/spell_definitions.json)   | `name`    |
| NPC attacks    | [`event.proto`](https://raw.githubusercontent.com/blert-io/protos/refs/heads/main/event.proto) (`NpcAttack` enum)      | enum name |

BCF documents may pin specific versions of these files via `config.definitions`
(see §3.2) to ensure compatibility as definitions evolve.

Examples of valid identifiers:

- **Player attacks**: `"SCYTHE"`, `"SANG"`, `"DAWN_SPEC"`, `"CLAW_SPEC"`
- **Player spells**: `"VENGEANCE"`, `"DEATH_CHARGE"`, `"VENGEANCE_OTHER"`
- **NPC attacks**: `"TOB_VERZIK_P2_BOUNCE"`, `"TOB_MAIDEN_AUTO"`, `"INFERNO_JAD_MAGE"`

#### 5.6.2 Unknown/Custom Types

For actions not in the canonical sources, use `"UNKNOWN"` with a `display`
override to provide rendering metadata. This applies to all action types:

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

### 5.7 Display Overrides

The `display` object allows BCF documents to override default rendering for
custom or unknown action types:

#### 5.7.1 Attack Display Override

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

#### 5.7.2 Spell Display Override

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

#### 5.7.3 NPC Attack Display Override

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
| `label`    | string | Yes      | Short label for display        |
| `fullText` | string | No       | Full description for tooltips  |
| `iconUrl`  | string | No       | Icon to display with the state |

### 6.3 State Persistence and Merging

State fields have different persistence behaviors:

#### 6.3.1 Persistent Fields

These fields carry forward across ticks until explicitly changed:

| Field        | Persists | Default     |
| ------------ | -------- | ----------- |
| `isDead`     | Yes      | `false`     |
| `specEnergy` | Yes      | `undefined` |

At tick 1, all actors start with default values for persistent fields unless
explicitly specified in their first cell.

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
      "name": "70s",
      "isImportant": true
    },
    {
      "tick": 50,
      "name": "50s",
      "isImportant": true
    }
  ]
}
```

| Field         | Type    | Required | Default | Description                              |
| ------------- | ------- | -------- | ------- | ---------------------------------------- |
| `tick`        | integer | Yes      | -       | Tick where the split occurs              |
| `name`        | string  | Yes      | -       | Split label                              |
| `isImportant` | boolean | No       | true    | Whether to emphasize this split visually |

### 7.2 Background Colors

Background colors highlight tick ranges to draw attention to significant events:

```json
{
  "backgroundColors": [
    {
      "tick": 8,
      "length": 1,
      "color": "#391717"
    },
    {
      "tick": 20,
      "length": 5,
      "color": "#39171780",
      "rowIds": ["p1", "p2"]
    }
  ]
}
```

| Field    | Type     | Required | Default | Description                                          |
| -------- | -------- | -------- | ------- | ---------------------------------------------------- |
| `tick`   | integer  | Yes      | -       | Starting tick                                        |
| `length` | integer  | No       | 1       | Number of ticks to color                             |
| `color`  | string   | Yes      | -       | Hex color (`#RRGGBB` or `#RRGGBBAA` with alpha)      |
| `rowIds` | string[] | No       | -       | Actor/custom row IDs to color. If omitted, all rows. |

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

| Field     | Type    | Required | Description                       |
| --------- | ------- | -------- | --------------------------------- |
| `tick`    | integer | Yes      | Tick number for this cell         |
| `iconUrl` | string  | No       | Icon URL to display               |
| `label`   | string  | No       | Short text label (1-3 characters) |
| `opacity` | number  | No       | Opacity (0.0-1.0), default 1.0    |

At least one of `iconUrl` or `label` should be provided for the cell to render
content.

## 8. Rendering Guidance

This section provides non-normative guidance for BCF renderers.

### 8.1 Grid Layout

BCF represents a grid where:

- **Columns** are ticks
- **Rows** are actors, ordered by `config.rowOrder` if provided, otherwise using
  a default order (typically: NPCs, custom rows, players)

### 8.2 Attack Type Resolution

Renderers should resolve action types as follows:

1. If the action has a `display` override, use those values.
2. Otherwise, look up the action type in the renderer's metadata.
3. If not found, fall back to unknown/default rendering.

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

```json
{
  "version": "1.0",
  "config": {
    "totalTicks": 3
  },
  "timeline": {
    "actors": [{ "type": "player", "id": "p1", "name": "Player" }],
    "ticks": [
      { "tick": 1, "cells": [] },
      {
        "tick": 2,
        "cells": [
          {
            "actorId": "p1",
            "actions": [{ "type": "attack", "attackType": "SCYTHE" }]
          }
        ]
      },
      { "tick": 3, "cells": [] }
    ]
  }
}
```

### 9.2 Verzik P1 Chart

```json
{
  "version": "1.0",
  "name": "Trio Verzik P1",
  "description": "Example P1 rotation for a trio",
  "config": {
    "totalTicks": 25
  },
  "timeline": {
    "actors": [
      { "type": "npc", "id": "verzik", "npcId": 8370, "name": "Verzik" },
      { "type": "player", "id": "p1", "name": "Player1" },
      { "type": "player", "id": "p2", "name": "Player2" },
      { "type": "player", "id": "p3", "name": "Player3" }
    ],
    "ticks": [
      {
        "tick": 1,
        "cells": [
          {
            "actorId": "p1",
            "actions": [
              {
                "type": "attack",
                "attackType": "DAWN_SPEC",
                "weaponId": 22516,
                "targetActorId": "verzik",
                "specCost": 35
              }
            ],
            "state": { "offCooldown": true, "specEnergy": 65 }
          },
          {
            "actorId": "p2",
            "actions": [
              {
                "type": "attack",
                "attackType": "SCYTHE",
                "weaponId": 22325,
                "targetActorId": "verzik"
              }
            ]
          },
          {
            "actorId": "p3",
            "actions": [
              {
                "type": "attack",
                "attackType": "SCYTHE",
                "weaponId": 22325,
                "targetActorId": "verzik"
              }
            ]
          }
        ]
      },
      {
        "tick": 5,
        "cells": [
          {
            "actorId": "p1",
            "actions": [
              {
                "type": "attack",
                "attackType": "SCYTHE",
                "weaponId": 22325,
                "targetActorId": "verzik"
              }
            ]
          }
        ]
      },
      {
        "tick": 19,
        "cells": [
          {
            "actorId": "verzik",
            "actions": [
              {
                "type": "npcAttack",
                "attackType": "TOB_VERZIK_P1_AUTO",
                "targetActorId": "p2"
              }
            ]
          }
        ]
      }
    ]
  },
  "augmentation": {
    "splits": [{ "tick": 25, "name": "P1 End" }],
    "backgroundColors": [{ "tick": 8, "color": "#391717" }]
  }
}
```

### 9.3 Chart with Custom States

```json
{
  "version": "1.0",
  "config": { "totalTicks": 10 },
  "timeline": {
    "actors": [
      { "type": "npc", "id": "verzik", "npcId": 8370, "name": "Verzik" },
      { "type": "player", "id": "p1", "name": "Healer" }
    ],
    "ticks": [
      {
        "tick": 5,
        "cells": [
          {
            "actorId": "p1",
            "actions": [
              {
                "type": "attack",
                "attackType": "SANG",
                "weaponId": 22323
              }
            ],
            "state": {
              "customStates": [
                {
                  "label": "24",
                  "fullText": "Healed Verzik for 24",
                  "iconUrl": "/images/verzik-tornado.png"
                }
              ]
            }
          }
        ]
      }
    ]
  }
}
```

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

A formal JSON Schema for BCF validation is available in the `@blert/bcf`
package: `bcf/schemas/bcf-1.0-strict.schema.json`

## Appendix B: Reference Implementation

The reference implementation for BCF parsing and validation is the `@blert/bcf`
package, located at `/bcf` in the Blert monorepo.

The reference renderer is the Blert web application's attack timeline component:
`web/app/components/attack-timeline/`
