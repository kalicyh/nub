//! `nub agent` — make AI coding agents reliably reach for nub.
//!
//! The command group has two verbs, both of which only PRINT to stdout — nub
//! never writes agent artifacts (skills, AGENTS.md, rules) into a user's
//! project. Onboarding is driven by a copyable prompt on the homepage that the
//! user pastes into their own coding agent; these verbs are the OFFLINE FALLBACK
//! for when that agent can't fetch the live docs over the web:
//!
//! - `docs`  — the docs entry point. With no args it prints the onboarding doc
//!   (`site/public/start.md`, also served at https://nubjs.com/start.md)
//!   followed by a table of contents of every docs page baked into the binary.
//!   `--page <slug>` prints one page's full markdown; `--list` prints just the
//!   TOC. The whole docs tree (`site/content/docs/**/*.mdx`) is baked in at
//!   build time, so an agent can pull the current docs with no network.
//! - `skill` — prints the evergreen agent skill (`site/public/skill.md`, also
//!   served at https://nubjs.com/skill.md) for the agent to install itself.
//!
//! `start.md`/`skill.md` are embedded via `include_str!`; the docs tree is baked
//! by `build.rs` into a `&[(slug, title, markdown)]` table — all so the verbs
//! work with no network fetch from a stale binary. This is a non-forwarding
//! group handled by a manual sub-verb match (like `nub node` / `nub pm`), so its
//! bare-usage and invalid-verb messages read consistently.

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

/// The full docs tree, baked in at build time by `build.rs` as a slug-sorted
/// `&[(slug, title, markdown)]` table with each page's YAML frontmatter
/// stripped. `nub agent docs` serves the TOC and `--page <slug>` content from
/// this with no network fetch.
mod baked {
    include!(concat!(env!("OUT_DIR"), "/docs_baked.rs"));
}
use baked::DOCS;

/// Entry point for `nub agent …`, dispatched from `dispatch_subcommand`.
pub fn run(args: &[String]) -> Result<i32> {
    let verb = args.first().map(String::as_str);
    if matches!(verb, None | Some("help") | Some("--help") | Some("-h")) {
        print_usage();
        return Ok(0);
    }
    match verb.expect("verb present after the help/bare guard") {
        "docs" => run_docs(&args[1..]),
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

/// `nub agent docs [--page <slug> | --list]`.
///
/// No args  → the onboarding doc (`start.md`) followed by the page TOC, so the
///            agent gets the starting prompt AND the full list of pages it can
///            pull via `--page`.
/// `--list` → just the TOC.
/// `--page <slug>` → that page's full markdown (frontmatter stripped). An
///            unknown slug errors with the valid slugs and exits non-zero.
fn run_docs(args: &[String]) -> Result<i32> {
    let mut page: Option<&str> = None;
    let mut list_only = false;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--list" | "--toc" => list_only = true,
            "--page" => {
                let slug = iter.next().map(String::as_str).ok_or_else(|| {
                    anyhow::anyhow!("nub agent docs --page needs a slug, e.g. `--page runtime/typescript`")
                })?;
                page = Some(slug);
            }
            other if other.starts_with("--page=") => {
                page = Some(&other["--page=".len()..]);
            }
            other => bail!(
                "nub agent docs: unexpected argument '{other}'. \
                 Usage: nub agent docs [--page <slug> | --list]."
            ),
        }
    }

    if let Some(slug) = page {
        return print_page(slug);
    }

    if !list_only {
        print!("{START_MD}");
        println!();
    }
    print_toc();
    Ok(0)
}

/// Print the markdown for one page, or error (exit 1) listing valid slugs.
fn print_page(slug: &str) -> Result<i32> {
    match DOCS.iter().find(|(s, _, _)| *s == slug) {
        Some((_, _, body)) => {
            print!("{body}");
            Ok(0)
        }
        None => {
            let mut msg =
                format!("nub agent docs: unknown page '{slug}'.\n\nAvailable pages:\n");
            for (s, title, _) in DOCS {
                msg.push_str(&format!("  {s} — {title}\n"));
            }
            bail!(msg);
        }
    }
}

/// Print the table of contents: one `<slug> — <title>` line per page.
fn print_toc() {
    println!("## Docs pages (pass any slug to `nub agent docs --page <slug>`)\n");
    for (slug, title, _) in DOCS {
        println!("  {slug} — {title}");
    }
}

fn print_usage() {
    println!(
        "nub agent — make AI coding agents reach for nub\n\n\
         Usage: nub agent <command>\n\n\
         Commands:\n\
         \x20 docs     print the onboarding doc + a TOC of every baked docs page\n\
         \x20          (offline fallback for https://nubjs.com/start.md)\n\
         \x20          --page <slug>  print one page's full markdown\n\
         \x20          --list         print just the page TOC\n\
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

    #[test]
    fn docs_tree_is_baked_with_section_root_slugs() {
        // The whole docs tree must be present, keyed by the site's routing slugs.
        // `index.mdx` collapses to its section root (`runtime/index.mdx` ->
        // `runtime`); the top-level `index.mdx` stays `index`.
        let slugs: Vec<&str> = DOCS.iter().map(|(s, _, _)| *s).collect();
        for expected in [
            "index",
            "runtime",
            "runtime/typescript",
            "install",
            "install/pnpm",
            "pm",
            "nubx",
            "run",
        ] {
            assert!(
                slugs.contains(&expected),
                "baked docs must include slug `{expected}`; got {slugs:?}"
            );
        }
        // No `*/index` leaked through un-collapsed.
        assert!(
            !slugs.iter().any(|s| s.ends_with("/index")),
            "section-root `index` slugs must collapse to the parent: {slugs:?}"
        );
        // Frontmatter is stripped: bodies don't start with the `---` fence, and
        // the title was lifted out of it.
        let ts = DOCS
            .iter()
            .find(|(s, _, _)| *s == "runtime/typescript")
            .expect("typescript page present");
        assert_eq!(ts.1, "TypeScript", "title comes from frontmatter");
        assert!(
            !ts.2.trim_start().starts_with("---"),
            "frontmatter must be stripped from the printed body"
        );
        assert!(
            ts.2.contains("oxc-based transpiler"),
            "baked body must be the real page content"
        );
    }

    #[test]
    fn docs_no_args_prints_start_then_toc() {
        // No args is the entry point: start.md + a TOC of every page.
        assert_eq!(run_docs(&[]).unwrap(), 0);
        // `--list` is the TOC-only variant.
        assert_eq!(run_docs(&["--list".into()]).unwrap(), 0);
    }

    #[test]
    fn docs_page_round_trips_and_unknown_slug_errors() {
        // A known slug serves that page; both `--page <slug>` and `--page=<slug>`.
        assert_eq!(
            run_docs(&["--page".into(), "runtime/typescript".into()]).unwrap(),
            0
        );
        assert_eq!(run_docs(&["--page=pm".into()]).unwrap(), 0);

        // Unknown slug is an error (non-zero exit via the bubbled-up anyhow).
        let err = run_docs(&["--page".into(), "nonexistent".into()]).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("unknown page 'nonexistent'"), "{msg}");
        assert!(
            msg.contains("runtime/typescript"),
            "error lists valid slugs: {msg}"
        );

        // `--page` with no slug is a usage error.
        assert!(run_docs(&["--page".into()]).is_err());
    }
}
