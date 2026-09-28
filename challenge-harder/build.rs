// clippy.toml's disallowed lists set determinism rules for server code which
// do not apply to the build script.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::io::Result;
use std::path::Path;

fn main() -> Result<()> {
    generate_attack_definitions()?;
    generate_spell_definitions()?;

    let proto_dir = "../proto";
    println!("cargo:rerun-if-changed={proto_dir}");
    let mut config = prost_build::Config::new();

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    config.file_descriptor_set_path(Path::new(&out_dir).join("blert_descriptor.bin"));

    for ty in [
        ".blert.Challenge",
        ".blert.ChallengeMode",
        ".blert.ChallengeUpdate.StageUpdate.Status",
        ".blert.Stage",
    ] {
        config.type_attribute(
            ty,
            "#[derive(serde_repr::Serialize_repr, serde_repr::Deserialize_repr)]",
        );
    }

    config.type_attribute(".blert.Coords", "#[derive(PartialOrd, Ord)]");

    // NPC kinds are stored as JSON within processor custom data.
    for ty in [
        ".blert.Event.Npc.type",
        ".blert.Event.Npc.MaidenCrab",
        ".blert.Event.Npc.Nylo",
        ".blert.Event.Npc.VerzikCrab",
    ] {
        config.type_attribute(ty, "#[derive(serde::Serialize, serde::Deserialize)]");
    }

    config.compile_protos(
        &[
            &format!("{proto_dir}/challenge_storage.proto"),
            &format!("{proto_dir}/event.proto"),
            &format!("{proto_dir}/server_message.proto"),
        ],
        &[proto_dir],
    )?;
    Ok(())
}

/// Generates attack metadata from the canonical JSON.
fn generate_attack_definitions() -> Result<()> {
    const DEFINITIONS_FILE: &str = "../proto/attack_definitions.json";
    println!("cargo:rerun-if-changed={DEFINITIONS_FILE}");

    let data = std::fs::read_to_string(DEFINITIONS_FILE)?;
    let definitions: serde_json::Value =
        serde_json::from_str(&data).map_err(std::io::Error::other)?;

    let mut entries = Vec::new();
    for definition in definitions.as_array().into_iter().flatten() {
        let (Some(id), Some(cooldown)) = (
            definition["protoId"].as_i64(),
            definition["cooldown"].as_i64(),
        ) else {
            return Err(std::io::Error::other("attack definition missing fields"));
        };
        entries.push((id, cooldown));
    }
    entries.sort_by_key(|&(id, _)| id);

    let mut out = String::from(
        "// Generated from the attack definitions JSON.\n\n\
         /// Returns an attack's cooldown in ticks.\n\
         pub const fn cooldown(id: i32) -> Option<u32> {\n    match id {\n",
    );
    for (id, cooldown) in entries {
        out.push_str(&format!("        {id} => Some({cooldown}),\n"));
    }
    out.push_str("        _ => None,\n    }\n}\n");

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    std::fs::write(Path::new(&out_dir).join("attack_definitions.rs"), out)
}

/// Generates spell metadata from the canonical JSON.
fn generate_spell_definitions() -> Result<()> {
    const DEFINITIONS_FILE: &str = "../proto/spell_definitions.json";
    println!("cargo:rerun-if-changed={DEFINITIONS_FILE}");

    let data = std::fs::read_to_string(DEFINITIONS_FILE)?;
    let definitions: serde_json::Value =
        serde_json::from_str(&data).map_err(std::io::Error::other)?;

    let mut targeted = Vec::new();
    for definition in definitions.as_array().into_iter().flatten() {
        let Some(id) = definition["id"].as_i64() else {
            return Err(std::io::Error::other("spell definition missing id"));
        };
        let has_target_graphics = definition["targetGraphics"]
            .as_array()
            .is_some_and(|graphics| !graphics.is_empty());
        if has_target_graphics {
            targeted.push(id);
        }
    }
    targeted.sort_unstable();
    if targeted.is_empty() {
        return Err(std::io::Error::other(
            "no spell definition has target graphics",
        ));
    }

    let patterns = targeted
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(" | ");
    let out = format!(
        "// Generated from the spell definitions JSON.\n\n\
         /// Returns whether a spell is cast on a target.\n\
         pub const fn is_targeted(id: i32) -> bool {{\n    matches!(id, {patterns})\n}}\n"
    );

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    std::fs::write(Path::new(&out_dir).join("spell_definitions.rs"), out)
}
