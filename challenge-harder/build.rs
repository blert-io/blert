// clippy.toml's disallowed lists set determinism rules for server code which
// do not apply to the build script.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::collections::HashSet;
use std::io::Result;
use std::path::Path;

fn main() -> Result<()> {
    generate_item_ids()?;

    let proto_dir = "../proto";
    println!("cargo:rerun-if-changed={proto_dir}");
    let mut config = prost_build::Config::new();

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    config.file_descriptor_set_path(Path::new(&out_dir).join("blert_descriptor.bin"));

    for ty in [
        ".blert.Challenge",
        ".blert.ChallengeMode",
        ".blert.Stage",
        ".blert.Event.StageUpdate.Status",
    ] {
        config.type_attribute(
            ty,
            "#[derive(serde_repr::Serialize_repr, serde_repr::Deserialize_repr)]",
        );
    }

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

/// Generates item ID constants from the OSRS item dump.
fn generate_item_ids() -> Result<()> {
    const ITEMS_FILE: &str = "../web/resources/extended_items.json";
    println!("cargo:rerun-if-changed={ITEMS_FILE}");

    let data = std::fs::read_to_string(ITEMS_FILE)?;
    let items: serde_json::Value = serde_json::from_str(&data).map_err(std::io::Error::other)?;

    let mut entries = Vec::new();
    for item in items.as_array().into_iter().flatten() {
        if item["bankNote"].as_bool().unwrap_or(false) {
            continue;
        }
        let (Some(id), Some(name)) = (item["id"].as_i64(), item["name"].as_str()) else {
            continue;
        };
        if name == "Null" {
            continue;
        }
        entries.push((id, name));
    }
    entries.sort_by_key(|&(id, _)| id);

    let mut out = String::from(
        "// Generated from the OSRS item dump. Bank notes and placeholder\n\
         // entries are excluded. Repeated names have an ID suffix.\n",
    );
    let mut seen = HashSet::new();
    for (id, name) in entries {
        let Some(constant) = constant_name(name) else {
            continue;
        };
        if seen.insert(constant.clone()) {
            out.push_str(&format!("pub const {constant}: i32 = {id};\n"));
        } else {
            out.push_str(&format!("pub const {constant}_{id}: i32 = {id};\n"));
        }
    }

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    std::fs::write(Path::new(&out_dir).join("item_id.rs"), out)
}

/// Converts an item name to a Rust constant identifier.
fn constant_name(name: &str) -> Option<String> {
    let mut result = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            result.push(c.to_ascii_uppercase());
        } else if !result.is_empty() && !result.ends_with('_') {
            result.push('_');
        }
    }
    let result = result.trim_end_matches('_');
    if result.is_empty() {
        None
    } else if result.starts_with(|c: char| c.is_ascii_digit()) {
        Some(format!("_{result}"))
    } else {
        Some(result.to_string())
    }
}
