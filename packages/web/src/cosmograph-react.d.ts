// Type shim for @cosmograph/react — the package lacks an "exports" field,
// which tsgo (nodenext) requires.  Vite and tsc --skipLibCheck resolve it fine.
declare module '@cosmograph/react' {
  import type { ForwardRefExoticComponent, MemoExoticComponent, RefAttributes } from 'react';

  export interface CosmographProps {
    [key: string]: unknown;
    links?: Array<unknown>;
    linkSourceBy?: string;
    linkSourceIndexBy?: string;
    linkTargetBy?: string;
    linkTargetIndexBy?: string;
    pointColorBy?: string;
    pointIdBy?: string;
    pointIndexBy?: string;
    pointLabelBy?: string;
    points?: Array<unknown>;
    pointSizeBy?: string;
  }

  export type CosmographRef = unknown;

  export const Cosmograph: MemoExoticComponent<
    ForwardRefExoticComponent<CosmographProps & RefAttributes<CosmographRef>>
  >;
}
