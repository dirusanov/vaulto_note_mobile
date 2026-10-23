import React from 'react';
import { Platform, View, ViewProps } from 'react-native';
import { requireNativeView } from 'expo';

/**
 * A View that makes Android deliver every touch sample inside it without
 * batching (see InkInputView.kt). A plain View elsewhere.
 */
export const InkInputView: React.ComponentType<ViewProps> = Platform.OS === 'android'
    ? requireNativeView('InkInput')
    : View;
