use blert::Rsn;

/// Hash identifying a party's members.
#[must_use]
pub fn party_hash(party: &[Rsn]) -> String {
    use sha2::{Digest, Sha256};
    use std::fmt::Write;

    // This intentionally deviates from the original server, fixing a latent
    // bug by normalizing before sorting. This value is not used for anything
    // beyond the live duration of a session, so parity does not matter.
    let mut names: Vec<String> = party.iter().map(Rsn::normalized).collect();
    names.sort_unstable();
    let digest = Sha256::digest(names.join("-").as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}
