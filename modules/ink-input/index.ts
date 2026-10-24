import React from 'react';
import { NativeSyntheticEvent, Platform, View, ViewProps } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';

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

/** True when strokes are drawn natively, under the pen, by InkLiveView (Android 10+). */
export const NATIVE_INK: boolean = Platform.OS === 'android'
    && !!(requireNativeModule('InkInput') as { nativeInk?: boolean }).nativeInk;

/** What the next stroke drawn natively looks like. */
export type InkLiveConfig = {
    /** Touches on the view draw (ink mode, nothing over the canvas). */
    enabled: boolean;
    /** Fingers draw too; otherwise only the pen. */
    fingers: boolean;
    tool: string;
    color: string;
    size: number;
    thinning: number;
    streamline: number;
    taper: boolean;
    nib: number;
    opacity: number;
    grain: boolean;
    snapShapes: boolean;
    /** Dark mode on the theme paper: ink shows smart-inverted, as on the canvas. */
    invert: boolean;
    hoverColor: string;
    /** [docWidth, pitch, pageHeight, pageCount] for pages, which clip the ink; null for a canvas. */
    pages: number[] | null;
};

export type InkStrokeEvent = {
    id: number;
    tool: string;
    color: string;
    size: number;
    /** Straightened into a shape by holding the pen still. */
    shape: boolean;
    /** Flat [x, y, pressure, ...] in document units. */
    points: number[];
};

export type InkLiveHandle = {
    setConfig: (config: InkLiveConfig) => Promise<void>;
    /** Document → screen: x * scale + tx, y * scale + ty (dp). */
    setTransform: (tx: number, ty: number, scale: number) => Promise<void>;
    /** The canvas draws these strokes now; the native layer stops showing them. */
    release: (ids: number[]) => Promise<void>;
};

export type InkLiveProps = ViewProps & {
    onInkBegin?: (event: NativeSyntheticEvent<{ stylus: boolean }>) => void;
    onInkStroke?: (event: NativeSyntheticEvent<InkStrokeEvent>) => void;
};

/**
 * Draws the stroke under the pen natively, in a low-latency layer over the
 * canvas (InkLiveView.kt). Only rendered where NATIVE_INK is true.
 */
export const InkLiveView = (NATIVE_INK ? requireNativeView('InkInput', 'InkLive') : View) as unknown as
    React.ComponentType<InkLiveProps & React.RefAttributes<InkLiveHandle>>;
