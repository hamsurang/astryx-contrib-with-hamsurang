// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * @file ChatComposer.tsx
 * @input React content, BaseProps DOM passthrough, StyleX overrides
 * @output Exports ChatComposer
 * @position Core implementation; consumed by index.ts
 *
 * SYNC: When modified, update these files to stay in sync:
 * - /packages/core/src/Chat/ChatComposer.doc.mjs (props table)
 * - /packages/core/src/Chat/ChatComposer.test.tsx
 * - /apps/storybook/stories/ChatComposer.stories.tsx
 */

import React, {useCallback, useState, type ReactNode} from 'react';
import * as stylex from '@stylexjs/stylex';
import type {BaseProps} from '../BaseProps';
import {useAnnounce} from '../hooks/useAnnounce';
import {useFocusTrap, useMergedRefs} from '../hooks';
import {useLayer} from '../Layer';
import {useTranslator} from '../i18n';
import {colorVars, spacingVars} from '../theme/tokens.stylex';
import {mergeProps, themeProps} from '../utils';
import {useComposerDraft} from './useComposerDraft';

const styles = stylex.create({
  root: {
    color: colorVars['--color-text-primary'],
    display: 'flex',
    gap: spacingVars['--spacing-1'],
    ':hover': {opacity: 0.9},
  },
  textarea: {
    padding: spacingVars['--spacing-2'],
  },
});

export interface ChatComposerProps extends BaseProps<HTMLDivElement> {
  label: string;
  children?: ReactNode;
}

export function ChatComposer({label, children, xstyle, ...rest}: ChatComposerProps) {
  const t = useTranslator();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const onSend = useCallback(() => announce(t('sent')), [announce, t]);
  return (
    <div
      {...mergeProps(themeProps('chat-composer'), stylex.props(styles.root, xstyle))}
      role="group"
      aria-label={label}
      {...rest}>
      <textarea {...stylex.props(styles.textarea)} aria-multiline="true" tabIndex={0} {...themeProps('chat-composer-input', {open})} />
      <button type="button" onClick={onSend}>{t('send')}</button>
      {children}
    </div>
  );
}

ChatComposer.displayName = 'ChatComposer';
