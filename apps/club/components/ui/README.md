# Club UI

Shared controls for the Club apps. The hidden seed board at `/demo` is the look these components encode. Tokens live in `apps/club/app/globals.css`. Import from `components/ui/index.ts`.

Board chrome stays in `globals.css` (`.admit`, `.deny`, `.people-row`, `.panel-search`, `.list-trigger`, `.stepper`, `.card-actions`). Those marks are unique to the review layout. `Button` and `Input` do not cover them.

## Tokens

`:root` in `globals.css` defines the palette. `@theme inline` exposes the same names as Tailwind colors.

| Token | Role |
| --- | --- |
| `canvas` | Page background |
| `subtle` | Hover fill |
| `surface` | Card and control fill |
| `raised` | Chip and kbd fill |
| `line` / `line-strong` | Borders |
| `ink` | Primary text |
| `secondary` / `muted` / `faint` | Secondary text |
| `accent` / `accent-hover` / `accent-tint` / `accent-text` | Focus and under-review |
| `warn` / `danger` / `success` | Status |

Shared motion and focus live as classes, not props.

| Class | Role |
| --- | --- |
| `press` | Scale on active for tappable controls |
| `caps` | Small uppercase label |
| `num` / `mono` | Tabular figures |
| `:focus-visible` | Accent ring from `--focus-ring` |

`inputClass` is the shared field chrome (`border-line`, `bg-surface`, `text-ink`, `placeholder:text-faint`). `Input`, `Textarea`, and `Select` apply it. Pass `className` to extend.

## Props

`Button`, `Input`, `Textarea`, and `Select` accept the native attributes for that element. The other controls take the fields below. `className` appends when the control lists it. `Button` defaults `type` to `button`. A form submit control sets `type="submit"`.

### Avatar

`name: string`, `size?: number` (default `26`). Renders initials. No `className`. Size is a pixel number because the mark is circular.

### Badge

`tone?: Tone` (from `lib/copy.ts`, default `neutral`), `title?: string`, `className?: string`, `children`. Tones map to token pairs (`warn` → `bg-warn-tint text-warn`).

### Button

`variant?: ButtonVariant` (`primary`, `secondary`, `ghost`, or `danger`, default `secondary`), `size?: ButtonSize` (`sm` or `md`, default `md`), `className?: string`, `children`. Uses `press`.

### EmptyState

`title: string`, `children?: ReactNode`, `className?: string`.

### Field

`label: string`, `hint?: string`, `children: ReactNode`, `className?: string`. The control is `children` inside a `<label>`. `Input`, `Textarea`, and `Select` are the usual children.

### Input, Textarea, Select

Native attributes for that element. `className` appends to `inputClass`.

### Kbd

`children: string`.

### Mark

`className?: string` (default `mark`). Tech@NYU ring.

### Num

`children: ReactNode`, `className?: string`. Adds `num`.

### Popover

`label: ReactNode`, `children: (close: () => void) => ReactNode`, `align?: "left" or "right"`, `variant?:` Button variant except `danger`, `size?: ButtonSize`, `width?: string`. The trigger is a `Button`.

### Section

`title: string`, `hint?: ReactNode`, `aside?: ReactNode`, `children: ReactNode`, `id?: string`.

### Segmented

`options: readonly T[]`, `value: T | null`, `onChange: (v: T | null) => void`, `captions?: Partial<Record<T, string>>`, `disabled?: boolean`, `allowNone?: string`. `T` is `string | number`.

### Sheet

`open: boolean`, `title: string`, `onClose: () => void`, `children: ReactNode`. Dialog name is `title`. Close control is named `Close`.
