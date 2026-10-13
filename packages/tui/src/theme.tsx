import React, { ReactNode } from 'react';
import { Text, Box } from 'ink';

export function isNoColor(): boolean {
  return Boolean(process.env.NO_COLOR && process.env.NO_COLOR !== '0');
}

export function safeColor(colorName?: string): string | undefined {
  if (!colorName || isNoColor()) {
    return undefined;
  }
  return colorName;
}

export interface ColoredTextProps {
  readonly color?: string | undefined;
  readonly bold?: boolean | undefined;
  readonly dimColor?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
  readonly strikethrough?: boolean | undefined;
  readonly children?: ReactNode | undefined;
}

export const ColoredText: React.FC<ColoredTextProps> = ({
  color,
  bold,
  dimColor,
  italic,
  underline,
  strikethrough,
  children,
}) => {
  const c = safeColor(color);
  const props: Record<string, unknown> = {};
  if (c) props['color'] = c;
  if (bold) props['bold'] = true;
  if (dimColor) props['dimColor'] = true;
  if (italic) props['italic'] = true;
  if (underline) props['underline'] = true;
  if (strikethrough) props['strikethrough'] = true;

  return React.createElement(Text, props, children);
};

export interface BorderBoxProps {
  readonly borderStyle?:
    'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'classic' | undefined;
  readonly borderColor?: string | undefined;
  readonly flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse' | undefined;
  readonly justifyContent?:
    'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | undefined;
  readonly alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | undefined;
  readonly paddingX?: number | undefined;
  readonly paddingY?: number | undefined;
  readonly padding?: number | undefined;
  readonly paddingLeft?: number | undefined;
  readonly paddingRight?: number | undefined;
  readonly marginX?: number | undefined;
  readonly marginY?: number | undefined;
  readonly marginTop?: number | undefined;
  readonly marginBottom?: number | undefined;
  readonly width?: number | string | undefined;
  readonly height?: number | string | undefined;
  readonly gap?: number | undefined;
  readonly children?: ReactNode | undefined;
}

export const BorderBox: React.FC<BorderBoxProps> = ({
  borderColor,
  borderStyle,
  children,
  ...rest
}) => {
  const c = safeColor(borderColor);
  const props: Record<string, unknown> = { ...rest };
  if (borderStyle) props['borderStyle'] = borderStyle;
  if (c) props['borderColor'] = c;

  return React.createElement(Box, props as React.ComponentProps<typeof Box>, children);
};
