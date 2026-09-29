// Copyright (c) Meta Platforms, Inc. and affiliates.
import React from 'react';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({bubble: {padding: 4}});

export function ChatMessage({text}: {text: string}) {
  return <p {...stylex.props(styles.bubble)}>{text}</p>;
}
