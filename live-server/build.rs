use std::io::Result;

fn main() -> Result<()> {
    let proto_dir = "../proto";
    prost_build::compile_protos(
        &[
            &format!("{proto_dir}/event.proto"),
            &format!("{proto_dir}/challenge_storage.proto"),
        ],
        &[proto_dir],
    )?;
    Ok(())
}
