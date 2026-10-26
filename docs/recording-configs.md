# Recording configs

A recording config tells the plugin which raw signals to capture, such as
object IDs to watch in each challenge or NPCs to track generically. The plugin
sends those signals as generic events, and the server interprets them.

This document lists the rules for changing configs and for reading streams
recorded under them. Breaking these rules causes released plugins to silently
lose data, so read it before touching a config, a plugin release, or an
interpreter.

## Two independent versions

Every recorded client stream has two versions which affect its behavior:

- **Config version** identifies a config's contents. It says what the plugin
  was asked to capture. Versions only increase.
- **Plugin version** identifies the plugin code. It says which config fields
  the plugin understands and which bespoke events it sends.

Each plugin always reports the latest config version it was sent by the server,
but that does not mean that it understands all the fields in that version.
Earlier plugins ignore unknown fields and continue to send the original events
they were built for.

The plugin reports its version in its connection metadata, and for each stage
it reports the version of the config it recorded with (`RecordingInfo`). That
reported version is the version the plugin received.

## How configs reach plugins

socket-server serves one current config to every plugin.

- The data repository holds each uploaded version at
  `recording-config/v<N>.json`, and `recording-config/current.json` specifies
  the current one.
- `POST /admin/recording-config` uploads a new version. Uploaded versions are
  immutable.
- `PUT /admin/recording-config/current` changes the current version.
  Every socket-server instance then pushes it to its connected plugins.
- Each plugin has a bundled config, which is the latest version at the time of
  its release.
- A plugin receives the current config when it connects.

## Rules for changing a config

1. **Only add.** Add fields, entries and IDs. Never change the type or shape of
   an existing field. Plugins ignore unexpected fields, but fail to parse the
   message if any known field's structure changes. The plugin continues to
   record under whatever config it had before.
2. **Cover every allowed release.** The current config has to contain everything
   any plugin release that can connect depends on.
3. **Every change is a new version.** Upload it, then make it current.

## Releases and bespoke events

Bespoke events go away only when a plugin release deletes the code that sends
them, one event or NPC at a time. Plugins are deliberately built so that bespoke
code either dual-emits or takes precedence over generic events, so a build that
sends bespoke events will always send them regardless of the config it was
pushed.

| Release            | Added                                                                   | Bespoke events removed                                                                            |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0.9.24 and earlier | none                                                                    | none                                                                                              |
| 0.10.0             | `objects`, OBJECTS events                                               | none; object events are sent both bespoke and raw                                                 |
| 0.10.1             | `npcDefinitions`, NPC_UPDATE `size`, `animation`, `target`, `spotAnims` | Bloat's NPC_SPAWN and NPC_DEATH, BLOAT_DOWN, BLOAT_UP, BLOAT_HANDS_SPLAT, TOB_BLOAT_STOMP attacks |
| 0.10.4             | none                                                                    | MOKHAIOTL_OBJECTS, MOKHAIOTL_SHOCKWAVE                                                            |
| next release       | NPC_UPDATE `overheads`                                                  | none                                                                                              |

Add a row for every release that adds config fields or event fields, or removes
bespoke events.

## Rules for interpreting a stream

Interpreters must check both versions to decide how to interpret a feature.

- **Erase bespoke events only in plugin releases that removed them.** Check the
  plugin version before a feature replaces bespoke events in a stream. Without
  this, data would be silently lost.
- **Treat a missing signal as absent only if the config requested it and was
  understood.** In addition to the plugin version, check the config version that
  first requested the signal. If the stream was recorded with an older config,
  that data was not recorded, rather than the signals being absent.
