import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// New React islands can use this shadcn-style primitive without changing the
// existing Astro controls or the atlas's established motion and color tokens.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[var(--action-accent)] text-black hover:brightness-110',
        outline: 'border border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:border-[var(--action-accent)]',
        ghost: 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-2)]',
      },
      size: {
        default: 'min-h-11 px-5 py-2',
        sm: 'min-h-9 px-3 py-1.5',
        lg: 'min-h-12 px-7 py-3',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
