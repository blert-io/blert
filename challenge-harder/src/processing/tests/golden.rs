//! Utilities for checking and updating golden test files.

use std::fmt;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use console::{Style, style};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use prost_reflect::{DescriptorPool, DynamicMessage};
use similar::{ChangeTag, TextDiff};

use crate::proto::{ChallengeData, Event};

/// Longest diff to print to stdout.
const MAX_INLINE_LINES: usize = 40;

static DESCRIPTOR_POOL: LazyLock<DescriptorPool> = LazyLock::new(|| {
    DescriptorPool::decode(
        include_bytes!(concat!(env!("OUT_DIR"), "/blert_descriptor.bin")).as_slice(),
    )
    .expect("descriptor pool decodes")
});

/// Compares a stage scenario's output artifacts against its golden files.
///
/// If the `UPDATE_GOLDEN` environment variable is set to `name`, or `all` for
/// all tests, the output is written to the golden files.
pub(super) fn assert_stage_artifacts(
    name: &str,
    custom_data: &serde_json::Value,
    challenge: &ChallengeData,
    events: &[Event],
) {
    assert_golden(
        name,
        &format!("{name}_custom_data.json.gz"),
        &serde_json::to_string_pretty(custom_data).expect("custom data serializes"),
    );
    assert_golden(
        name,
        &format!("{name}_challenge.json.gz"),
        &serde_json::to_string_pretty(&proto_json("blert.ChallengeData", challenge))
            .expect("challenge data serializes"),
    );
    let events = events
        .iter()
        .map(|event| proto_json("blert.Event", event).to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert_golden(name, &format!("{name}_events.jsonl.gz"), &events);
}

fn read_golden(path: &Path) -> std::io::Result<String> {
    let mut contents = String::new();
    GzDecoder::new(File::open(path)?).read_to_string(&mut contents)?;
    Ok(contents)
}

fn write_golden(path: &Path, contents: &str) -> std::io::Result<()> {
    let mut encoder = GzEncoder::new(File::create(path)?, Compression::best());
    encoder.write_all(contents.as_bytes())?;
    encoder.finish()?;
    Ok(())
}

/// Renders a proto message as canonical JSON.
fn proto_json<M: prost::Message>(full_name: &str, message: &M) -> serde_json::Value {
    let descriptor = DESCRIPTOR_POOL
        .get_message_by_name(full_name)
        .expect("message descriptor exists");
    let dynamic = DynamicMessage::decode(descriptor, message.encode_to_vec().as_slice())
        .expect("message re-decodes");
    serde_json::to_value(&dynamic).expect("message serializes")
}

fn assert_golden(test_name: &str, filename: &str, actual: &str) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/processing")
        .join(filename);

    if let Some(name) = std::env::var_os("UPDATE_GOLDEN")
        && (name == test_name || name == "all")
    {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_golden(&path, actual).unwrap();
        return;
    }

    let expected = read_golden(&path).unwrap_or_else(|_| {
        panic!("missing golden `{test_name}`; create it with UPDATE_GOLDEN={test_name}")
    });

    if actual == expected {
        return;
    }

    let text_diff = TextDiff::from_lines(expected.as_str(), actual);

    let mut unified = text_diff.unified_diff();
    unified
        .header("expected", "actual")
        .missing_newline_hint(false);
    let plain = unified.to_string();

    let diff_path = std::env::temp_dir().join(format!("challenge_harder_golden_{test_name}.diff"));
    std::fs::write(&diff_path, &plain).unwrap();
    let actual_path =
        std::env::temp_dir().join(format!("challenge_harder_golden_{test_name}.actual.txt"));
    std::fs::write(&actual_path, actual).unwrap();

    let changes = text_diff
        .iter_all_changes()
        .filter(|change| change.tag() != ChangeTag::Equal)
        .count();
    eprintln!(
        "{}",
        style(format!(
            "golden `{test_name}` mismatch ({changes} changes; {:.2}% different)",
            (1.0 - text_diff.ratio()) * 100.0
        ))
        .red()
        .bold()
    );

    if plain.lines().count() <= MAX_INLINE_LINES {
        print_diff(&text_diff);
    } else {
        eprintln!(
            "{}",
            style(format!(
                "(diff too large to show inline: {} lines)",
                plain.lines().count()
            ))
            .dim()
        );
    }

    eprintln!("{} {}", style("diff written to").dim(), diff_path.display());
    eprintln!(
        "`{test_name}` {} {}",
        style("output written to").dim(),
        actual_path.display()
    );
    panic!(
        "If this is intentional, run with UPDATE_GOLDEN={test_name} to regenerate the golden file"
    );
}

fn print_diff(diff: &TextDiff<'_, '_, str>) {
    for (idx, group) in diff.grouped_ops(3).iter().enumerate() {
        // Separate non-contiguous hunks.
        if idx > 0 {
            eprintln!("{}", style("┄".repeat(48)).dim());
        }

        for op in group {
            for change in diff.iter_inline_changes(op) {
                let (sign, line_style) = match change.tag() {
                    ChangeTag::Delete => ("-", Style::new().red()),
                    ChangeTag::Insert => ("+", Style::new().green()),
                    ChangeTag::Equal => (" ", Style::new().dim()),
                };

                eprint!(
                    "{}{} {} ",
                    style(LineNo(change.old_index())).dim(),
                    style(LineNo(change.new_index())).dim(),
                    line_style.apply_to(sign).bold(),
                );

                // Underline the segments that actually changed.
                for (emphasized, value) in change.iter_strings_lossy() {
                    let segment = line_style.apply_to(value);
                    if emphasized {
                        eprint!("{}", segment.underlined());
                    } else {
                        eprint!("{segment}");
                    }
                }

                if change.missing_newline() {
                    eprintln!();
                }
            }
        }
    }
}

struct LineNo(Option<usize>);

impl fmt::Display for LineNo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(n) => write!(f, "{:>4}", n + 1),
            None => f.write_str("    "),
        }
    }
}
