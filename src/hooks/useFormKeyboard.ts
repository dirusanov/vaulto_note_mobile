import { RefObject, useCallback, useEffect, useRef } from 'react';
import { Keyboard, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Space kept above a focused field: its label stays visible too. */
const FIELD_MARGIN_TOP = 96;

/**
 * A form in a ScrollView that the keyboard never covers. The app draws edge to
 * edge on Android, so the window does not shrink for the keyboard: a
 * KeyboardAvoidingView with `behavior` (see `keyboardBehavior`) makes room,
 * and the focused field is scrolled into view once the keyboard is up.
 * `bottomInset` keeps the last button off the gesture bar.
 */
export const useFormKeyboard = () => {
    const insets = useSafeAreaInsets();
    const scrollRef = useRef<ScrollView>(null);
    /** Wraps everything inside the ScrollView: offsets are measured against it. */
    const contentRef = useRef<View>(null);
    const focused = useRef<RefObject<TextInput | null> | null>(null);

    const reveal = useCallback(() => {
        const input = focused.current?.current as any;
        const content = contentRef.current as any;
        if (!input?.measureLayout || !content) return;
        input.measureLayout(
            content,
            (_x: number, y: number) => {
                scrollRef.current?.scrollTo({ y: Math.max(0, y - FIELD_MARGIN_TOP), animated: true });
            },
            () => undefined,
        );
    }, []);

    useEffect(() => {
        const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const subscription = Keyboard.addListener(event, () => {
            // After the padding for the keyboard is laid out.
            setTimeout(reveal, Platform.OS === 'ios' ? 50 : 80);
        });
        return () => subscription.remove();
    }, [reveal]);

    /** Pass to a field's onFocus. */
    const onFieldFocus = useCallback((input: RefObject<TextInput | null>) => {
        focused.current = input;
        // The keyboard may already be open (moving from one field to the next).
        if (Keyboard.isVisible()) setTimeout(reveal, 50);
    }, [reveal]);

    return {
        scrollRef,
        contentRef,
        onFieldFocus,
        keyboardBehavior: (Platform.OS === 'ios' ? 'padding' : 'height') as 'padding' | 'height',
        bottomInset: insets.bottom,
    };
};
