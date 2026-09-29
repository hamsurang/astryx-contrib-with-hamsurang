# Component Audit Rubric

## Reviewing a change

> **Which checks, from what the diff touches.** Include a group only when its trigger fires:
>
> | If the diff touches… | Run |
> |---|---|
> | `stylex.create`, a `*.stylex.ts`, or any colour/spacing/radius/shadow value | §2 T1–T3, T12–T15 · §5a D1/D4/D5 |
> | `.doc.mjs` props, stories, or a block | §8 X5, X9–X12 |
> | a published export, or anything consumer-visible | §3 P11–P12 · X20 changeset |
>
> Two rules that override the triage.

## The checks

T1 no hardcoded colours.
