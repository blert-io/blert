# @blert/bcf

Blert Chart Format (BCF) parser, validator, resolver, and TypeScript types.

BCF is a JSON-based data interchange format for representing combat timelines
in Old School RuneScape. It enables portable sharing of attack rotations and
fight timelines between users and tools.

## Usage

### Validation

Use `validate()` to validate parsed JSON data, or `parseAndValidate()` to parse
and validate a JSON string in one step.

```typescript
import { validate, parseAndValidate } from '@blert/bcf';

// Validate parsed data, auto-detecting version
const data: unknown = JSON.parse(jsonString);
const result: ValidationResultLax = validate(data);

if (result.valid) {
  console.log('Validated BCF:', result.document);
  console.log('Detected version:', result.version);
} else {
  console.error('Validation errors:', result.errors);
}

// Parse and validate a JSON string
const result = parseAndValidate(jsonString);

// Validate against a specific version in strict mode
const result = validate(data, { version: '1.0' });

// Validate against a specific version in lax mode
const result = validate(data, { version: '1.0', strict: false });
```

#### Strict vs Lax Mode

- **Strict mode** (`strict: true`): Rejects documents with unknown properties.
  Best for ensuring exact schema compliance.
- **Lax mode** (`strict: false`): Allows additional properties not in the
  schema. Best for forward compatibility with newer minor versions.

When `version` is specified, strict mode is the default. When auto-detecting
version, lax mode is the default.

### Resolver

`BCFResolver` provides efficient lookups and lazy state resolution for BCF
documents. State resolution handles persistent fields that carry forward across
ticks.

```typescript
import { validate, BCFResolver } from '@blert/bcf';

const result = validate(data);
if (!result.valid) {
  throw new Error('Invalid BCF document');
}

const resolver = new BCFResolver(result.document);

// Query document metadata:
console.log(resolver.name); // Chart name (if set)
console.log(resolver.totalTicks); // Total ticks in timeline
console.log(resolver.startTick, resolver.endTick); // Display range

// Query actors:
const actor = resolver.getActor('player-1');
const allActors = resolver.getActors();

// Query ticks and cells:
const tick = resolver.getTick(5);
const cell = resolver.getCell('player-1', 5);

// Efficiently access resolved state:
const playerState = resolver.getPlayerState('player-1', 10);
if (playerState) {
  console.log(playerState.isDead);
  console.log(playerState.specEnergy);
  console.log(playerState.offCooldown);
}

const npcState = resolver.getNpcState('boss', 10);
if (npcState) {
  console.log(npcState.label);
}

// Query custom rows:
const customRow = resolver.getCustomRow('orbs');
const customCell = resolver.getCustomRowCell('orbs', 5);
const allCustomRows = resolver.getCustomRows();

// Query splits:
const split = resolver.getSplitAtTick(10);
const allSplits = resolver.getSplits();

// Query background colors:
const background = resolver.getBackgroundColorAtTick(5);
const rowBackground = resolver.getBackgroundColorAtTick(5, 'player-1');
if (background) {
  console.log(background.color, background.intensity);
}
```

### Types

The package exports all BCF types for use in your application:

```typescript
import type {
  // Document types
  BlertChartFormat,
  BlertChartFormatStrict,
  BlertChartFormatLax,

  // Timeline types
  BCFConfig,
  BCFTimeline,
  BCFTick,
  BCFCell,

  // Actor types
  BCFActor,
  BCFPlayerActor,
  BCFNpcActor,

  // Action types
  BCFAction,
  BCFLaxAction,
  BCFAttackAction,
  BCFSpellAction,
  BCFDeathAction,
  BCFNpcAttackAction,

  // State types
  BCFState,
  BCFPlayerState,
  BCFNpcState,
  BCFCustomState,

  // Augmentation types
  BCFAugmentation,
  BCFSplit,
  BCFBackgroundColor,
  BCFCustomRow,
  BCFCustomRowCell,

  // Resolved state types
  ResolvedPlayerState,
  ResolvedNpcState,
  ResolvedActorState,
} from '@blert/bcf';
```

## Documentation

See [docs/spec.md](docs/spec.md) for the complete BCF specification.

## JSON Schemas

BCF schemas are available in the `schemas/` directory:

- `bcf-1.0-strict.schema.json`: Strict schema enforcing exact fields for
  BCF 1.0.
- `bcf-1.x-lax.schema.json`: Lax schema allowing additional fields for
  forward compatibility with BCF 1.x versions.

## File Extension

BCF documents use the `.bcf.json` file extension.
