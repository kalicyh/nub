//! `nub agent` — make AI coding agents reliably reach for nub.
//!
//! The command group has two verbs, both of which only PRINT to stdout — nub
//! never writes agent artifacts (skills, AGENTS.md, rules) into a user's
//! project. Onboarding is driven by a copyable prompt on the homepage that the
//! user pastes into their own coding agent; these verbs are the OFFLINE FALLBACK
//! for when that agent can't fetch the live docs over the web:
//!
//! - `docs`  — prints the onboarding doc (`site/public/start.md`, also served at
//!   https://nubjs.com/start.md). This is the entry point the homepage prompt
//!   points the agent at; the verb is the offline fallback for that fetch.
//! - `skill` — prints the evergreen agent skill (`site/public/skill.md`, also
//!   served at https://nubjs.com/skill.md) for the agent to install itself.
//!
//! Both files are embedded via `include_str!` so the verbs work with no network
//! fetch from a stale binary. This is a non-forwarding group handled by a manual
//! sub-verb match (like `nub node` / `nub pm`), so its bare-usage and
//! invalid-verb messages read consistently.

use anyhow::{Result, bail};

/// The onboarding doc, authored once at `site/public/start.md` (so the same file
/// also serves at https://nubjs.com/start.md) and embedded here so `nub agent
/// docs` prints it offline with no network fetch. It's the entry prompt the
/// homepage points an agent at — the offline fallback for fetching that URL.
const START_MD: &str = include_str!("../../../../site/public/start.md");

/// The EVERGREEN agent skill, authored once at `site/public/skill.md` (so the same
/// file also serves at https://nubjs.com/skill.md) and embedded here so `nub agent
/// skill` prints it offline with no network fetch. It's a thin, STABLE orientation
/// layer that points the agent at the always-current sources (`nub --help`,
/// https://nubjs.com/docs, https://nubjs.com/llms.txt) — self-healing even from a
/// stale binary. It deliberately omits volatile detail (exhaustive flag lists).
const SKILL_MD: &str = include_str!("../../../../site/public/skill.md");

/// Entry point for `nub agent …`, dispatched from `dispatch_subcommand`.
pub fn run(args: &[String]) -> Result<i32> {
    let verb = args.first().map(String::as_str);
    if matches!(verb, None | Some("help") | Some("--help") | Some("-h")) {
        print_usage();
        return Ok(0);
    }
    match verb.expect("verb present after the help/bare guard") {
        "docs" => {
            print!("{START_MD}");
            Ok(0)
        }
        "skill" => {
            print!("{SKILL_MD}");
            Ok(0)
        }
        other => bail!(
            "nub agent takes a subcommand (docs, skill). Unknown verb '{other}'. \
             See `nub agent --help`."
        ),
    }
}

fn print_usage() {
    println!(
        "nub agent — make AI coding agents reach for nub\n\n\
         Usage: nub agent <command>\n\n\
         Commands:\n\
         \x20 docs     print nub's agent onboarding doc to stdout\n\
         \x20          (offline fallback for https://nubjs.com/start.md)\n\
         \x20 skill    print nub's evergreen agent skill to stdout (install it yourself)"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_verb_errors() {
        assert!(run(&["bogus".into()]).is_err());
    }

    #[test]
    fn docs_verb_prints_the_onboarding_doc() {
        // `nub agent docs` prints the embedded start.md and exits 0.
        assert_eq!(run(&["docs".into()]).unwrap(), 0);

        let body = START_MD;
        assert!(!body.trim().is_empty(), "onboarding doc must not be empty");
        // It's the entry prompt: it must carry the self-healing pointers at the
        // always-current sources plus the install + `--node` escape hatch.
        for pointer in ["nubjs.com/llms.txt", "nub --version", "--node"] {
            assert!(
                body.contains(pointer),
                "onboarding doc must reference `{pointer}`"
            );
        }
    }

    #[test]
    fn skill_verb_prints_evergreen_skill_with_the_key_pointers() {
        // `nub agent skill` prints the embedded skill and exits 0.
        assert_eq!(run(&["skill".into()]).unwrap(), 0);

        // The skill is the EVERGREEN orientation layer: it must be non-empty and
        // carry the self-healing pointers at the always-current sources, plus the
        // `--node` escape hatch. (We assert against the embedded const directly —
        // it's what `run` prints verbatim.)
        let body = SKILL_MD;
        assert!(!body.trim().is_empty(), "skill must not be empty");
        // First line is the YAML front-matter fence. Compare line-ending-agnostically:
        // a Windows checkout embeds the file with CRLF, so `body` may start with "---\r\n".
        assert_eq!(
            body.lines().next(),
            Some("---"),
            "skill needs YAML front matter"
        );
        for pointer in [
            "nubjs.com/docs",
            "nubjs.com/llms.txt",
            "nub --help",
            "--node",
        ] {
            assert!(
                body.contains(pointer),
                "evergreen skill must point the agent at `{pointer}`"
            );
        }
    }

    #[test]
    fn bare_and_help_print_usage_ok() {
        assert_eq!(run(&[]).unwrap(), 0);
        assert_eq!(run(&["help".into()]).unwrap(), 0);
        assert_eq!(run(&["--help".into()]).unwrap(), 0);
    }
}
