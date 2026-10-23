import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    AlertButton,
    AlertOptions,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { colors, isDarkScheme } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

/**
 * Drop-in for Alert.alert. Android's system dialog (teal ALL-CAPS buttons) does
 * not match the app, so there the alert is drawn by <AppAlertHost />, styled like
 * the app's other dialogs. iOS keeps the native alert, which already fits. Until
 * the host is mounted (early start-up), the native alert is used everywhere.
 */
type PendingAlert = {
    id: number;
    title: string;
    message?: string;
    buttons: AlertButton[];
    options?: AlertOptions;
};

let nextId = 1;
let queue: PendingAlert[] = [];
let listener: ((queue: PendingAlert[]) => void) | null = null;

export const appAlert = (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
): void => {
    if (Platform.OS !== 'android' || !listener) {
        Alert.alert(title, message, buttons, options);
        return;
    }
    // The same question asked again replaces the one still queued. A hardware
    // Escape key cancels an alert's window natively, without onRequestClose, so
    // that alert would stay first in the queue, unseen, and hide every later one;
    // asked anew it gets a new id, and the host a new window (keyed by id).
    const fresh = { id: nextId++, title, message, buttons: buttons?.length ? buttons : [], options };
    queue = [...queue.filter((item) => item.title !== title || item.message !== message), fresh];
    listener(queue);
};

const dismissCurrent = () => {
    queue = queue.slice(1);
    listener?.(queue);
};

export const AppAlertHost = () => {
    const { t } = useTranslation();
    const [pending, setPending] = useState<PendingAlert[]>(queue);

    useEffect(() => {
        listener = setPending;
        return () => {
            if (listener === setPending) listener = null;
        };
    }, []);

    const current = pending[0];
    if (!current) {
        return null;
    }

    const buttons: AlertButton[] = current.buttons.length
        ? current.buttons
        : [{ text: t('common.ok', 'OK') }];
    const cancelButton = buttons.find((button) => button.style === 'cancel');
    // The last action is the main one (Android puts the positive button last);
    // the cancel button becomes the quiet text button at the bottom.
    const actions = buttons.filter((button) => button !== cancelButton).reverse();

    const press = (button?: AlertButton) => {
        dismissCurrent();
        button?.onPress?.();
    };

    // Back / tapping outside: cancel when there is a cancel button, acknowledge a
    // one-button notice, otherwise only when the caller allowed dismissing.
    const handleRequestClose = () => {
        if (cancelButton) {
            press(cancelButton);
        } else if (buttons.length === 1) {
            press(buttons[0]);
        } else if (current.options?.cancelable) {
            dismissCurrent();
            current.options.onDismiss?.();
        }
    };

    return (
        <Modal key={current.id} visible transparent animationType="fade" statusBarTranslucent onRequestClose={handleRequestClose}>
            <TouchableWithoutFeedback onPress={handleRequestClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.card} accessibilityViewIsModal>
                            <ScrollView bounces={false} style={styles.body} contentContainerStyle={styles.bodyContent}>
                                {!!current.title && (
                                    <Text style={styles.title} accessibilityRole="header">{current.title}</Text>
                                )}
                                {!!current.message && <Text style={styles.message}>{current.message}</Text>}
                            </ScrollView>
                            <View style={styles.actions}>
                                {actions.map((button, index) => {
                                    const destructive = button.style === 'destructive';
                                    const primary = index === 0;
                                    return (
                                        <TouchableOpacity
                                            key={`${button.text}-${index}`}
                                            onPress={() => press(button)}
                                            activeOpacity={0.85}
                                            style={[
                                                styles.button,
                                                primary
                                                    ? [styles.buttonPrimary, destructive && styles.buttonDestructive]
                                                    : styles.buttonSecondary,
                                            ]}
                                            accessibilityRole="button"
                                        >
                                            <Text
                                                style={[
                                                    styles.buttonText,
                                                    primary
                                                        ? (destructive ? styles.buttonTextOnDestructive : styles.buttonTextPrimary)
                                                        : destructive && styles.buttonTextDestructive,
                                                ]}
                                                numberOfLines={2}
                                            >
                                                {button.text ?? t('common.ok', 'OK')}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                                {cancelButton && (
                                    <TouchableOpacity
                                        onPress={() => press(cancelButton)}
                                        activeOpacity={0.6}
                                        style={styles.cancelButton}
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.cancelText}>{cancelButton.text ?? t('common.cancel', 'Cancel')}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = createStyles(() => ({
    overlay: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.l,
    },
    card: {
        width: '100%',
        maxWidth: 340,
        maxHeight: '85%',
        backgroundColor: colors.surface,
        borderRadius: 20,
        paddingHorizontal: spacing.l,
        paddingTop: spacing.l,
        paddingBottom: spacing.s,
        borderWidth: isDarkScheme() ? StyleSheet.hairlineWidth : 0,
        borderColor: colors.border,
    },
    body: {
        flexGrow: 0,
    },
    bodyContent: {
        paddingBottom: spacing.l,
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '700',
        letterSpacing: -0.3,
        color: colors.text,
        marginBottom: spacing.s,
    },
    message: {
        fontSize: 15,
        lineHeight: 21,
        color: colors.textSecondary,
    },
    actions: {
        gap: spacing.xs,
    },
    button: {
        minHeight: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.m,
    },
    buttonPrimary: {
        backgroundColor: colors.primary,
    },
    buttonDestructive: {
        backgroundColor: colors.error,
    },
    buttonSecondary: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderHover,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        textAlign: 'center',
    },
    buttonTextPrimary: {
        color: colors.onPrimary,
    },
    buttonTextOnDestructive: {
        // The dark theme's red is light: white on it would be hard to read.
        color: isDarkScheme() ? colors.background : colors.onPrimary,
    },
    buttonTextDestructive: {
        color: colors.error,
    },
    cancelButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.textSecondary,
    },
}));
