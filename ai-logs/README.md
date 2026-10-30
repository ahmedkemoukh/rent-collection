# AI logs

- **`01-cursor-agent.md`** is the full session with the Cursor agent, which ran all the commands and wrote the code. It lists my prompts and the agent's replies in order, with each tool call summarized to one line. Secrets are replaced with `[REDACTED]`.
- **The prompts I sent to the agent** were prepared in a separate discussion with ChatGPT, Claude and Grok. I compared their suggestions, chose and corrected them against the brief, and only then sent them to the agent.
- **Suggestions I rejected because they contradict the brief:**
  - **`'[)'` in the lease `daterange`.** Both lease dates are inclusive, so the overlap constraint uses `'[]'`.
  - **Returning money as `String` instead of converting `BigInt`.** The API contract says `amountSen: number`, so amounts are returned as numbers.
