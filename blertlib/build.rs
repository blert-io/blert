use std::collections::HashSet;
use std::fmt::Write as _;
use std::io::Result;
use std::path::Path;

fn main() -> Result<()> {
    generate_item_ids()?;
    generate_attack_definitions()?;
    generate_spell_definitions()?;

    let proto_dir = "../proto";
    println!("cargo:rerun-if-changed={proto_dir}");

    prost_build::Config::new().compile_protos(&[&format!("{proto_dir}/event.proto")], &[proto_dir])
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
        writeln!(out, "        {id} => Some({cooldown}),").map_err(std::io::Error::other)?;
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
        let (Some(id), Some(name)) = (item["id"].as_u64(), item["name"].as_str()) else {
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
            writeln!(out, "pub const {constant}: u32 = {id};").map_err(std::io::Error::other)?;
        } else {
            writeln!(out, "pub const {constant}_{id}: u32 = {id};")
                .map_err(std::io::Error::other)?;
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
