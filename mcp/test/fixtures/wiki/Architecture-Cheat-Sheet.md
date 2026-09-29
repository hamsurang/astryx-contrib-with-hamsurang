# Astryx Architecture Cheat Sheet

> Operational routing guide.

## Choose only what applies

| Trigger | Compose this owner API |
|---|---|
| Announce a state transition | `useAnnounce` + `useTranslator`; audit A6/A7/A16 |
| Trap/restore focus | `useFocusTrap`; layer participants also join dismissal |
| Open floating/modal UI | Existing `Dialog`/`Popover` family first; otherwise `useLayer` + dismissal owners |
| Accept or provide size | `useSize`; container owners use `SizeProvider` |

## Tier 1 — always check when applicable

### Layer protocol suite

Prefer an existing layer family: it already owns portal placement, dismissal, nesting, focus, and lifecycle. `useLayer` is low-level infrastructure.

```tsx
<Popover label="Settings" />
```

Route: `packages/core/src/Layer/`; [Component Audit Rubric §1](Component-Audit-Rubric).

### Accessibility primitives

Name every control from its visible label; announce transitions with `useAnnounce`.

Route: audit A6/A7.

## Tier 2 — check when triggered

### Size cascade

Resolve explicit prop → inherited context → default through `useSize`.

Route: `SizeContext/SizeContext.ts`.

## Behavior units

Not a tier.
