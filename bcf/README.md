# @blert/bcf

Blert Chart Format (BCF) parser, validator, and TypeScript types.

BCF is a JSON-based data interchange format for representing combat timelines
in Old School RuneScape. It enables portable sharing of attack rotations and
fight timelines between users and tools.

## Documentation

See [docs/spec.md](docs/spec.md) for the latest complete BCF specification.

## JSON Schemas

BCF schemas are available in the `schemas/` directory and come in two flavors:

- `strict`: The strict schema enforces exact fields for a particular
  `MAJOR.MINOR` version of BCF.

- `lax`: The lax schema allows for a particular `MAJOR` version allows for
  additional fields not specified by the latest BCF specification for the same
  `MAJOR` version. It is recommended for tools that want to ensure forward
  compatibility with minor version changes.

## File Extension

BCF documents use the `.bcf.json` file extension.
