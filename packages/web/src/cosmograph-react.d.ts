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

  /* eslint-disable @typescript-eslint/no-explicit-any */
  export const vg: {
    barY(data: Array<unknown>, options: any): any;
    colorDomain(domain: Array<string>): any;
    colorLegend(show: boolean): any;
    colorRange(range: Array<string>): any;
    height(h: number): any;
    plot(...args: Array<any>): HTMLElement;
    width(w: number): any;
    xLabel(label: string): any;
    xTickRotate(angle: number): any;
    xTickSpacing(px: number): any;
    yGrid(show: boolean): any;
    yLabel(label: string): any;
  };
}
