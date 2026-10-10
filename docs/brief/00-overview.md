> Original brief, exported 2026-10-09 from https://claude.ai/artifact/WUfZLJt14WMczryiEVHmt3 — superseded by the matching docs/0N-*.md where they differ.

# Handshake: development documents

2026-10-08 · Prashant Kumar Yadav

These seven documents are enough to build, test and ship Handshake for the PayPal AI Hackathon. Each tab is one document.

| Document | Question it answers | Read it when |
| --- | --- | --- |
| 1. Requirements | What must the product do, and for whom? | Before writing any code |
| 2. System design | How do the parts fit together? | Before week 1 |
| 3. Database schema | What is stored, and in what shape? | When writing the first migration |
| 4. API specification | What does each endpoint accept and return? | When building routes and pages |
| 5. AI specification | What does the model see, return, and never decide? | Week 2 |
| 6. Test plan | How do we know it works? | Alongside every feature |
| 7. Setup and deployment | How does someone else run it? | Week 0, then again before submitting |

The stack assumed throughout is Next.js with TypeScript, Postgres with Prisma, the PayPal sandbox, a multimodal model with JSON output, AG Grid, and Render. Change the stack in one place and the documents still hold; only the setup tab needs editing.

PayPal endpoint paths and webhook event names are written from memory, apart from authorize, capture and reauthorize. Check each against the PayPal API reference as you implement it.
