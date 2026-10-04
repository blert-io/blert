use std::collections::HashSet;
use std::fmt::Write as _;
use std::io::Result;
use std::path::Path;

fn main() -> Result<()> {
    generate_item_ids()?;
    generate_attack_definitions()?;
    generate_spell_definitions()?;
    generate_npc_definitions()?;

    let proto_dir = "../proto";
    println!("cargo:rerun-if-changed={proto_dir}");

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    prost_build::Config::new()
        .file_descriptor_set_path(Path::new(&out_dir).join("blert_descriptor.bin"))
        .compile_protos(&[&format!("{proto_dir}/event.proto")], &[proto_dir])
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
        let (Some(id), Some(cooldown), Some(category)) = (
            definition["protoId"].as_i64(),
            definition["cooldown"].as_i64(),
            definition["category"].as_str(),
        ) else {
            return Err(std::io::Error::other("attack definition missing fields"));
        };
        let style = match category {
            "MELEE" => "Melee",
            "RANGED" => "Ranged",
            "MAGIC" => "Magic",
            _ => return Err(std::io::Error::other("unknown attack category")),
        };
        entries.push((id, cooldown, style));
    }
    entries.sort_by_key(|&(id, _, _)| id);

    let mut out = String::from(
        "// Generated from the attack definitions JSON.\n\n\
         /// Returns an attack's cooldown in ticks.\n\
         pub const fn cooldown(id: i32) -> Option<u32> {\n    match id {\n",
    );
    for &(id, cooldown, _) in &entries {
        writeln!(out, "        {id} => Some({cooldown}),").map_err(std::io::Error::other)?;
    }
    out.push_str("        _ => None,\n    }\n}\n");

    out.push_str(
        "\n/// Returns an attack's combat style.\n\
         pub const fn style(id: i32) -> Option<crate::CombatStyle> {\n    match id {\n",
    );
    for &(id, _, style) in &entries {
        writeln!(out, "        {id} => Some(crate::CombatStyle::{style}),")
            .map_err(std::io::Error::other)?;
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

/// Generates NPC ID constants and a definition table from the canonical JSON.
fn generate_npc_definitions() -> Result<()> {
    const DEFINITIONS_FILE: &str = "../proto/npc_definitions.json";

    #[derive(PartialEq)]
    struct Definition {
        full_name: String,
        short_name: String,
        canonical_id: u64,
        size: u64,
    }

    println!("cargo:rerun-if-changed={DEFINITIONS_FILE}");

    let data = std::fs::read_to_string(DEFINITIONS_FILE)?;
    let definitions: serde_json::Value =
        serde_json::from_str(&data).map_err(std::io::Error::other)?;

    let mut ids = Vec::new();
    let mut groups: Vec<(Definition, Vec<u64>)> = Vec::new();
    for definition in definitions.as_array().into_iter().flatten() {
        let (
            Some(name),
            Some(id),
            Some(full_name),
            Some(short_name),
            Some(canonical_id),
            Some(size),
        ) = (
            definition["name"].as_str(),
            definition["id"].as_u64(),
            definition["fullName"].as_str(),
            definition["shortName"].as_str(),
            definition["canonicalId"].as_u64(),
            definition["size"].as_u64(),
        )
        else {
            return Err(std::io::Error::other("npc definition missing fields"));
        };
        ids.push((id, name.to_string()));
        let definition = Definition {
            full_name: full_name.to_string(),
            short_name: short_name.to_string(),
            canonical_id,
            size,
        };
        match groups
            .iter_mut()
            .find(|(existing, _)| *existing == definition)
        {
            Some((_, group)) => group.push(id),
            None => groups.push((definition, vec![id])),
        }
    }
    ids.sort_by_key(|&(id, _)| id);

    let mut out = String::from("pub mod id {\n");
    for (id, name) in ids {
        writeln!(out, "    pub const {name}: u32 = {id};").map_err(std::io::Error::other)?;
    }
    out.push_str(
        "}\n\n\
         /// Returns the definition of an NPC.\n\
         #[must_use]\n\
         pub const fn definition(npc_id: u32) -> Option<&'static Definition> {\n    match npc_id {\n",
    );
    for (definition, group) in groups {
        let patterns = group
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(" | ");
        writeln!(
            out,
            "        {patterns} => Some(&Definition {{\n            full_name: {:?},\n            short_name: {:?},\n            canonical_id: {},\n            size: {},\n        }}),",
            definition.full_name, definition.short_name, definition.canonical_id, definition.size
        )
        .map_err(std::io::Error::other)?;
    }
    out.push_str("        _ => None,\n    }\n}\n");

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    std::fs::write(Path::new(&out_dir).join("npc_definitions.rs"), out)
}
