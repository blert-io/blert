// clippy.toml's disallowed lists set determinism rules for server code which
// do not apply to the build script.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::io::Result;
use std::path::Path;

fn main() -> Result<()> {
    let proto_dir = "../proto";
    println!("cargo:rerun-if-changed={proto_dir}");
    let mut config = prost_build::Config::new();

    let out_dir = std::env::var("OUT_DIR").map_err(std::io::Error::other)?;
    config.file_descriptor_set_path(Path::new(&out_dir).join("blert_descriptor.bin"));

    for ty in [
        "Challenge",
        "ChallengeMode",
        "Coords",
        "Event",
        "EventStream",
        "NpcAttack",
        "PlayerAttack",
        "PlayerSpell",
        "Stage",
    ] {
        config.extern_path(format!(".blert.{ty}"), format!("::blert::proto::{ty}"));
    }

    config.type_attribute(
        ".blert.ChallengeUpdate.StageUpdate.Status",
        "#[derive(serde_repr::Serialize_repr, serde_repr::Deserialize_repr)]",
    );

    config.compile_protos(
        &[
            &format!("{proto_dir}/challenge_storage.proto"),
            &format!("{proto_dir}/server_message.proto"),
        ],
        &[proto_dir],
    )?;
    Ok(())
}
