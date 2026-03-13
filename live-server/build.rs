use std::io::Result;

fn main() -> Result<()> {
    let proto_dir = "../proto";
    prost_build::compile_protos(&[&format!("{proto_dir}/event.proto")], &[proto_dir])?;
    Ok(())
}
