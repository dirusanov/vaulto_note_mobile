import React from 'react';
import { Platform, View, ViewProps } from 'react-native';
import { requireNativeView } from 'expo';

/**
 * A View that makes Android deliver every touch sample inside it without
 * batching, keeps a resting palm away while a pen writes and marks an erasing
 * pen (see InkInputView.kt). A plain View elsewhere.
 */
export const InkInputView: React.ComponentType<ViewProps> = Platform.OS === 'android'
    ? requireNativeView('InkInput')
    : View;

/** Pen pressure that InkInputView reports for the eraser end or the side button. */
export const ERASER_PRESSURE = -2;
