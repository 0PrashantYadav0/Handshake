# Prompts for the dashboard agent

Type any of these into the prompt box on `/dashboard` (the box appears when `ANTHROPIC_API_KEY` is set on the server). The first six are also the prompt starters in the chat panel. All six built-in Studio agents (Lead, Planning, Data, Page, Widget) and the custom `auditor` run on `claude-sonnet-5-5` through `POST /api/studio/agent`; the agent reads the signed-in user's own deals and cannot change a deal or move money.

| Prompt | What happens |
| --- | --- |
| `Show my voided deals this month` | Lead → Data (`view_schema`, `execute_query`) → Widget: a grid of deals filtered to status `voided` and this month |
| `Chart held versus released money by week` | Lead → Widget: a column chart over the decision date with the held, released and returned sums |
| `Which deals went to buyer review, and why?` | Lead → Data: `execute_query` on `decision = 'buyer_review'`, then `auditor` → `explain_verdict` per code |
| `Why was HS-7K2Q voided?` | Lead → `auditor` → `explain_verdict('HS-7K2Q')`: every condition, its verdict, confidence and reason, the decision and the money trail. Use a code from your own ledger; the demo persona has one voided deal. |
| `Add a tile with the average verdict confidence` | Lead → Widget: a `value` widget over `verdicts.confidence`, average |
| `Add the deal pipeline widget to this page` | Lead → Widget: the custom `deal-pipeline` widget (T-37) |

More that work:

- `How much money is held right now, and for which deals?`
- `Which conditions fail most often?`
- `Explain the last decision on HS-7K2Q` (same path as "why was it voided"; `auditor` quotes the stored verdict rows)
- `Why can't you release the money on HS-7K2Q?` (the agent explains that the fixed decision function in code decides, and points to `/deal/HS-7K2Q`)

How `explain_verdict` works: Studio declares it with `kind: "server"`, so the browser never runs it. The route executes it with the signed-in user's session (`lib/studio-tools.ts` over `getDeal` and `getEvents`), feeds the result back to the model as a tool result wrapped in `<deal_record untrusted="true">`, and repeats at most three times before the answer. A code the user is not party to, or an unknown code, comes back to the model as a tool error ("You are not a party to this deal.", "No deal with that code."), never as a failed request. The limit is 30 prompts per user per 10 minutes.
