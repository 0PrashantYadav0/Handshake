# PayPal AI Hackathon: rules that shape Handshake

As of 2026-10-09. Source: [paypalaihackathon.devpost.com](https://paypalaihackathon.devpost.com/), its [rules](https://paypalaihackathon.devpost.com/rules), [schedule](https://paypalaihackathon.devpost.com/details/dates) and [AG Grid](https://paypalaihackathon.devpost.com/details/aggrid) / [Render](https://paypalaihackathon.devpost.com/details/render) sponsor pages.

## Dates

| Period | Begins | Ends |
| --- | --- | --- |
| Submissions | 2026-10-01 09:15 PDT | **2026-11-12 12:00 PST** |
| Judging | 2026-12-01 14:00 PST | 2026-12-15 08:00 PST |
| Winners announced | | 2026-12-21 09:00 PST |

Internal dates: feature freeze **2026-11-08**, submit **2026-11-11** (one day of buffer). The hosted demo must keep working until **2026-12-15**.

## What a submission must contain

- A project that **meaningfully uses both PayPal (sandbox) and AI**. No tracks, no prescribed problem.
- A **text description** of features and functionality.
- A **functional demo**: a hosted URL, or complete run instructions so judges can build and run it. Mockups and non-functional demos do not qualify.
- **Tools used**, and how each was used.
- A **public repository** (GitHub, GitLab or Bitbucket) with all source, assets and instructions, **open source, with a licence file visible in the GitHub About section** (a `LICENSE` file at the repo root).
- A **demo video under 3 minutes**, showing the project working on the device it was built for, public on YouTube, with no third-party trademarks or copyrighted music.

## Judging

Two stages. Stage one is a pass/fail check against the requirements above. Stage two scores five criteria with **equal weight**; ties are broken by the first criterion, then the next:

1. **Technological implementation**: how thoroughly and skilfully PayPal and the AI tools are used; genuine effort; a working, non-trivial implementation.
2. **Design**: a complete, coherent product experience, not a proof of concept.
3. **Potential impact**: a credible, specific case for a real problem and a real audience, addressed by what is demonstrated.
4. **Innovation/idea**: creativity and novelty.
5. **Presentation**: the video shows the project working end to end and explains the problem, the audience and why it matters.

## Prizes we target

| Prize | Amount | Why it fits |
| --- | --- | --- |
| 1st / 2nd / 3rd place | $12,000 / $8,000 / $5,000 | Overall score |
| Best Use of PayPal + AI | $5,000 | Authorize, capture, void and Payouts driven by an AI verdict behind a fixed safety rule |
| Best Use of AG Grid | $5,000 / $2,000 / $1,000 | Judged on **AG Studio**: custom widgets, theming, layout and a custom agent, "not just AG Grid or AG Charts on their own" |

A project can win at most one grand or honourable-mention prize plus one sponsor prize. We do not target Best Use of Agentic Commerce: Handshake deliberately gives the model no tools.

## Sponsor facts we rely on

- **AG Grid / AG Studio**: free 45-day trial licence; a missing or expired key shows a watermark but does not disable features (see `docs/research/ag-grid.md`). PayPal's boilerplate ([paypaldev/hackathon-paypal-ag-grid-boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate)) has no licence file, so we reuse its patterns, not its files.
- **Render**: $50 of credits via the hackathon claim link; paid plans are required for a demo that stays awake through judging (see `docs/research/stack.md`).
- **PayPal sandbox**: free; a REST app plus sandbox business and personal accounts (see `docs/research/paypal.md`).
- Questions go to the PayPal Discord linked from the resources page.

## Repository status

`github.com/0PrashantYadav0/Handshake` is **private** as of 2026-10-09. It must be made public, with `LICENSE` at the root, before submission.
