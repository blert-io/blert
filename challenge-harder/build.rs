use std::io::Result;

fn main() -> Result<()> {
    let proto_dir = "../proto";
    let mut config = prost_build::Config::new();

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
