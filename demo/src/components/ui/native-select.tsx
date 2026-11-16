import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return <div className="relative w-full"><select data-slot="native-select" className={cn('h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-9 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} /><ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" /></div>;
}
function NativeSelectOption(props: React.ComponentProps<'option'>) { return <option data-slot="native-select-option" {...props} />; }
export { NativeSelect, NativeSelectOption };
